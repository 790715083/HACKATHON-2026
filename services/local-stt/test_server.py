import io
import json
import threading
import unittest
import urllib.error
import urllib.request
import wave

from server import LocalServer, MODEL_ID, MAX_BODY, parse_upload, read_audio


def audio(seconds=1, channels=1, width=2, rate=16000):
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(width)
        wav.setframerate(rate)
        wav.writeframes(b"\x00" * int(seconds * rate) * channels * width)
    return output.getvalue()


def multipart(data=None, model=MODEL_ID):
    boundary = "moonlit-stt-test-boundary"
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n{model}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.wav"\r\n'
            'Content-Type: audio/wav\r\n\r\n').encode() + (audio() if data is None else data) + f'\r\n--{boundary}--\r\n'.encode()
    return f"multipart/form-data; boundary={boundary}", body


class FakeModel:
    def __init__(self):
        self.calls = []

    def transcribe(self, pcm, rate, channels):
        self.calls.append((len(pcm), rate, channels))
        return "我怀疑三号的发言。"


class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = LocalServer(0, FakeModel())
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def post(self, data=None, model=MODEL_ID, headers=None):
        content_type, body = multipart(data, model)
        request = urllib.request.Request(self.base + "/v1/audio/transcriptions", data=body,
                                         headers={"Content-Type": content_type, **(headers or {})})
        return urllib.request.urlopen(request, timeout=3)

    def test_health_and_transcription(self):
        with urllib.request.urlopen(self.base + "/health", timeout=3) as response:
            self.assertEqual(json.load(response)["model"], MODEL_ID)
        with self.post() as response:
            self.assertEqual(json.load(response)["text"], "我怀疑三号的发言。")
            self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(self.server.model.calls[-1], (32000, 16000, 1))

    def test_rejects_bad_audio_models_types_origins_and_large_uploads(self):
        before = len(self.server.model.calls)
        for data, model, headers, status in [
            (b"renamed webm", MODEL_ID, {}, 400), (audio(31), MODEL_ID, {}, 400),
            (audio(), "wrong-model", {}, 400), (audio(), MODEL_ID, {"Content-Type": "text/plain"}, 415),
            (audio(), MODEL_ID, {"Origin": "https://untrusted.example"}, 403),
            (audio(), MODEL_ID, {"Content-Length": str(MAX_BODY + 1)}, 413),
        ]:
            with self.subTest(status=status), self.assertRaises(urllib.error.HTTPError) as raised:
                self.post(data, model, headers)
            self.assertEqual(raised.exception.code, status)
            raised.exception.close()
        self.assertEqual(len(self.server.model.calls), before)

    def test_inference_concurrency_is_bounded(self):
        self.server.inference.acquire()
        try:
            with self.assertRaises(urllib.error.HTTPError) as raised:
                self.post()
            self.assertEqual(raised.exception.code, 503)
            raised.exception.close()
        finally:
            self.server.inference.release()

    def test_failed_requests_release_inference_slot(self):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.post(b"not wav")
        raised.exception.close()
        with self.post() as response:
            self.assertEqual(response.status, 200)


class ValidationTests(unittest.TestCase):
    def test_pcm_duration_rates_and_channels(self):
        for seconds, channels, rate in [(0.2, 1, 8000), (30, 2, 48000), (1, 1, 16000)]:
            pcm, actual_rate, actual_channels = read_audio(audio(seconds, channels, rate=rate))
            self.assertEqual((len(pcm), actual_rate, actual_channels), (int(seconds * rate) * channels * 2, rate, channels))
        for data in [audio(0.1), audio(31), audio(channels=3), audio(width=4), audio(rate=4000), audio()[:-2], b"not wav"]:
            with self.subTest(length=len(data)), self.assertRaises(ValueError):
                read_audio(data)

    def test_multipart_validation(self):
        content_type, body = multipart()
        self.assertEqual(parse_upload(content_type, body), audio())
        for content_type, body in [("multipart/form-data", b"invalid"), multipart(b""), multipart(model="remote")]:
            with self.assertRaises(ValueError):
                parse_upload(content_type, body)
        content_type, body = multipart()
        duplicate = body.replace(b'--moonlit-stt-test-boundary--', b'--moonlit-stt-test-boundary\r\nContent-Disposition: form-data; name="model"\r\n\r\nother\r\n--moonlit-stt-test-boundary--')
        with self.assertRaises(ValueError):
            parse_upload(content_type, duplicate)


if __name__ == "__main__":
    unittest.main()
