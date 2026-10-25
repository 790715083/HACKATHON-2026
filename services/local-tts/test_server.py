import io
import json
import threading
import unittest
import urllib.error
import urllib.request
import wave

from server import LocalServer, MODEL_ID, VOICES, validate_request


class FakeModel:
    calls = []

    def synthesize(self, *args):
        self.calls.append(args)
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(b"\x00\x00" * 240)
        return output.getvalue()


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

    def post(self, body, content_type="application/json"):
        request = urllib.request.Request(self.base + "/v1/audio/speech", data=json.dumps(body).encode(),
                                         headers={"Content-Type": content_type})
        return urllib.request.urlopen(request, timeout=3)

    def test_health_and_voice_catalog(self):
        with urllib.request.urlopen(self.base + "/health", timeout=3) as response:
            self.assertEqual(json.load(response)["model"], MODEL_ID)
        with urllib.request.urlopen(self.base + "/v1/audio/voices", timeout=3) as response:
            self.assertEqual(set(json.load(response)["voices"]), set(VOICES))

    def test_speech_endpoint_returns_wav(self):
        with self.post({"input": "先看票型。", "voice": "zm_009", "speed": 1.02}) as response:
            self.assertEqual(response.headers["Content-Type"], "audio/wav")
            with wave.open(io.BytesIO(response.read()), "rb") as wav:
                self.assertEqual(wav.getframerate(), 24000)
                self.assertEqual(wav.getnframes(), 240)
        self.assertEqual(self.server.model.calls[-1], ("先看票型。", 58, 1.02))

    def test_invalid_input_and_content_type(self):
        for body, content_type, status in [({}, "application/json", 400),
                                           ({"input": "测试"}, "text/plain", 415),
                                           ({"input": "长" * 20000}, "application/json", 413)]:
            with self.subTest(status=status), self.assertRaises(urllib.error.HTTPError) as raised:
                self.post(body, content_type)
            self.assertEqual(raised.exception.code, status)
            raised.exception.close()

    def test_concurrent_inference_is_bounded(self):
        self.server.synthesis.acquire()
        try:
            with self.assertRaises(urllib.error.HTTPError) as raised:
                self.post({"input": "测试"})
            self.assertEqual(raised.exception.code, 503)
            raised.exception.close()
        finally:
            self.server.synthesis.release()


class ValidationTests(unittest.TestCase):
    def test_rejects_invalid_and_unbounded_requests(self):
        for body in [[], None, {}, {"input": " "}, {"input": "长" * 1025}, {"input": 4},
                     {"input": "测试", "speed": True}, {"input": "测试", "speed": float("nan")},
                     {"input": "测试", "speed": 100}, {"input": "测试", "voice": []},
                     {"input": "测试", "model": "cloud"}, {"input": "测试", "response_format": "mp3"},
                     {"input": "测试", "stream": True}]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                validate_request(body)


if __name__ == "__main__":
    unittest.main()
