"""Loopback-only SenseVoice STT. Audio stays in memory and is never logged."""
import argparse
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import threading
import wave

MODEL_ID = "sensevoice-small-int8"
MODEL_DIRECTORY = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
MAX_AUDIO = 25 * 1024 * 1024
MAX_BODY = MAX_AUDIO + 65536
ROOT = Path(__file__).resolve().parents[2]


def parse_upload(content_type, body):
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + body)
    if not message.is_multipart() or message.defects:
        raise ValueError("请使用有效的 multipart/form-data。")
    fields = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name or name in fields or part.is_multipart() or part.defects:
            raise ValueError("录音表单字段无效或重复。")
        fields[name] = part.get_payload(decode=True)
    if fields.get("model") != MODEL_ID.encode() or fields.get("response_format", b"json") != b"json":
        raise ValueError(f"本地模型须为 {MODEL_ID}，返回格式须为 json。")
    audio = fields.get("file")
    if not audio or len(audio) > MAX_AUDIO:
        raise ValueError("请提供不超过 25 MiB 的 WAV 录音。")
    return audio


def read_audio(data):
    """Validate PCM before allocating the float array or invoking native code."""
    try:
        if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            raise ValueError("请使用 PCM WAV 录音。")
        if int.from_bytes(data[4:8], "little") != len(data) - 8:
            raise ValueError("WAV 录音不完整。")
        with wave.open(io.BytesIO(data), "rb") as wav:
            channels, width, rate, count = wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()
            if channels not in (1, 2) or width != 2 or not 8000 <= rate <= 192000 or wav.getcomptype() != "NONE":
                raise ValueError("本地识别需要单声道或双声道、16 位 PCM WAV。")
            if not 0.2 <= count / rate <= 30.1:
                raise ValueError("每段录音须在 0.2 至 30 秒之间。")
            pcm = wav.readframes(count)
            if len(pcm) != count * width * channels:
                raise ValueError("WAV 录音不完整。")
            return pcm, rate, channels
    except (wave.Error, EOFError) as error:
        raise ValueError("WAV 录音无效或不完整。") from error


class SenseVoice:
    def __init__(self, directory, threads):
        import sherpa_onnx
        if any(not (directory / name).is_file() for name in ["model.int8.onnx", "tokens.txt"]):
            raise ValueError("本地识别模型不完整，请先运行 pnpm stt:setup。")
        self.engine = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(directory / "model.int8.onnx"), tokens=str(directory / "tokens.txt"),
            language="zh", use_itn=True, num_threads=threads, provider="cpu", debug=False)

    def transcribe(self, pcm, rate, channels):
        import numpy as np
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        if channels == 2:
            samples = samples.reshape(-1, 2).mean(axis=1)
        if np.max(np.abs(samples)) < 0.0001:
            return ""
        stream = self.engine.create_stream()
        stream.accept_waveform(rate, samples)
        self.engine.decode_stream(stream)
        return stream.result.text.strip()


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port, model):
        super().__init__(("127.0.0.1", port), Handler)
        self.model = model
        self.inference = threading.BoundedSemaphore(1)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def respond(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.respond(200, {"status": "ok", "model": MODEL_ID, "device": "cpu"})
        else:
            self.respond(404, {"error": "接口不存在。"})

    def do_POST(self):
        try:
            if self.path != "/v1/audio/transcriptions":
                self.respond(404, {"error": "接口不存在。"})
                return
            # The Next.js adapter is the only browser entry point.
            if self.headers.get("Origin"):
                self.respond(403, {"error": "请通过游戏页面进行语音输入。"})
                return
            if self.headers.get_content_type() != "multipart/form-data":
                self.respond(415, {"error": "请使用 multipart/form-data。"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY:
                    self.respond(413, {"error": "录音表单为空或过大。"})
                    return
            except ValueError:
                self.respond(400, {"error": "Content-Length 无效。"})
                return
            if not self.server.inference.acquire(blocking=False):
                self.respond(503, {"error": "本地识别正在处理其他录音，请稍后重试。"})
                return
            try:
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError("录音表单不完整。")
                audio = parse_upload(self.headers.get("Content-Type"), body)
                pcm, rate, channels = read_audio(audio)
                text = self.server.model.transcribe(pcm, rate, channels)
            finally:
                self.server.inference.release()
            self.respond(200, {"text": text})
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except ValueError as error:
            self.respond(400, {"error": str(error)})
        except Exception:
            self.respond(500, {"error": "本地识别失败，请重试或重新启动服务。"})

    def log_message(self, format, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description="本地 SenseVoice 中文语音识别服务")
    parser.add_argument("--port", type=int, default=8881)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--model-dir", type=Path, default=ROOT / ".data/stt" / MODEL_DIRECTORY)
    args = parser.parse_args()
    if not 1 <= args.threads <= 16:
        parser.error("threads 须在 1 至 16 之间")
    print("正在加载本地 SenseVoice 中文模型……", flush=True)
    model = SenseVoice(args.model_dir.resolve(), args.threads)
    with LocalServer(args.port, model) as server:
        print(f"本地识别就绪：http://127.0.0.1:{args.port}（CPU，离线推理）", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
