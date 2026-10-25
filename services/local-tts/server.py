"""Loopback-only, offline Kokoro TTS with an OpenAI-compatible speech endpoint."""
import argparse
import io
import json
import math
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import wave

MODEL_ID = "kokoro-v1.1-zh"
# Official v1.1-zh speaker IDs, shared with the seat mapping in local-tts.ts.
VOICES = {"zf_001": 3, "zf_002": 4, "zf_003": 5, "zf_004": 6, "zf_005": 7,
          "zm_009": 58, "zm_010": 59, "zm_011": 60, "zm_012": 61, "zm_013": 62}
ROOT = Path(__file__).resolve().parents[2]


def validate_request(body):
    if not isinstance(body, dict):
        raise ValueError("请求必须是 JSON 对象。")
    text = body.get("input")
    if not isinstance(text, str) or not text.strip() or len(text) > 1024:
        raise ValueError("配音文本须为 1 至 1024 个字符。")
    if body.get("model", MODEL_ID) != MODEL_ID:
        raise ValueError(f"模型须为 {MODEL_ID}。")
    voice = body.get("voice", "zf_001")
    if not isinstance(voice, str) or voice not in VOICES:
        raise ValueError("不支持的本地音色，请通过 /v1/audio/voices 查看音色。")
    speed = body.get("speed", 1.0)
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 0.5 <= speed <= 2:
        raise ValueError("语速须在 0.5 至 2 之间。")
    if body.get("response_format", "wav") != "wav" or body.get("stream", False) is not False:
        raise ValueError("本地配音只支持非流式 WAV。")
    return text.strip(), VOICES[voice], float(speed)


class Kokoro:
    def __init__(self, directory, threads):
        import sherpa_onnx
        directory = directory.resolve()
        required = ["model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-zh.txt",
                    "lexicon-us-en.txt", "number-zh.fst", "date-zh.fst", "phone-zh.fst"]
        if any(not (directory / name).exists() for name in required):
            raise ValueError("本地模型文件不完整，请先运行 pnpm tts:setup。")
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(directory / "model.int8.onnx"),
                    voices=str(directory / "voices.bin"), tokens=str(directory / "tokens.txt"),
                    lexicon=",".join(str(directory / name) for name in ["lexicon-zh.txt", "lexicon-us-en.txt"]),
                ), provider="cpu", num_threads=threads,
            ),
            rule_fsts=",".join(str(directory / name) for name in ["phone-zh.fst", "date-zh.fst", "number-zh.fst"]),
            max_num_sentences=1,
        )
        if not config.validate():
            raise ValueError("本地模型配置无效，请重新运行 pnpm tts:setup。")
        self.engine = sherpa_onnx.OfflineTts(config)

    def synthesize(self, text, sid, speed):
        import numpy as np
        import sherpa_onnx
        config = sherpa_onnx.GenerationConfig()
        config.sid = sid
        config.speed = speed
        config.silence_scale = 0.2
        audio = self.engine.generate(text, config)
        if not len(audio.samples):
            raise ValueError("模型未生成音频，请尝试其他发言。")
        pcm = (np.clip(audio.samples, -1, 1) * 32767).astype("<i2").tobytes()
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(audio.sample_rate)
            wav.writeframes(pcm)
        return output.getvalue()


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port, model):
        super().__init__(("127.0.0.1", port), Handler)
        self.model = model
        self.synthesis = threading.BoundedSemaphore(1)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def respond(self, status, body, content_type="application/json"):
        data = json.dumps(body, ensure_ascii=False).encode() if isinstance(body, dict) else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.respond(200, {"status": "ok", "model": MODEL_ID, "device": "cpu", "voices": len(VOICES)})
        elif self.path == "/v1/audio/voices":
            self.respond(200, {"voices": list(VOICES)})
        else:
            self.respond(404, {"error": "接口不存在。"})

    def do_POST(self):
        try:
            if self.path != "/v1/audio/speech":
                self.respond(404, {"error": "接口不存在。"})
                return
            if self.headers.get_content_type() != "application/json":
                self.respond(415, {"error": "请使用 application/json。"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16384:
                    self.respond(413, {"error": "请求内容为空或超过 16 KiB。"})
                    return
                text, sid, speed = validate_request(json.loads(self.rfile.read(length)))
            except (ValueError, UnicodeError):
                self.respond(400, {"error": "配音参数或文本无效，请检查模型、音色、语速和 WAV 格式。"})
                return
            if not self.server.synthesis.acquire(blocking=False):
                self.respond(503, {"error": "本地配音正在处理其他请求，请稍后重播。"})
                return
            try:
                audio = self.server.model.synthesize(text, sid, speed)
            finally:
                self.server.synthesis.release()
            self.respond(200, audio, "audio/wav")
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass  # The browser stopped playback; do not log speech or a traceback.
        except Exception:
            self.respond(500, {"error": "本地模型合成失败，请重试或重新启动服务。"})

    def log_message(self, format, *args):
        pass  # Speech and game content never enter request logs.


def main():
    parser = argparse.ArgumentParser(description="本地 Kokoro 中文配音服务")
    parser.add_argument("--port", type=int, default=8880)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--model-dir", type=Path, default=ROOT / ".data/tts/kokoro-int8-multi-lang-v1_1")
    args = parser.parse_args()
    if not 1 <= args.threads <= 16:
        parser.error("threads 须在 1 至 16 之间")
    print("正在加载本地 Kokoro 中文模型……", flush=True)
    model = Kokoro(args.model_dir, args.threads)
    with LocalServer(args.port, model) as server:
        print(f"本地配音就绪：http://127.0.0.1:{args.port}（CPU，离线推理）", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
