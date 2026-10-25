"""Install the local CPU runtime and verified Kokoro weights inside .data/tts."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import venv

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / ".data" / "tts"
MODEL = "kokoro-int8-multi-lang-v1_1"
MODEL_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/{MODEL}.tar.bz2"
MODEL_SHA256 = "a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6"


def main():
    if sys.version_info < (3, 12):
        raise SystemExit("本地 TTS 需要 Python 3.12+。")
    DATA.mkdir(parents=True, exist_ok=True)
    environment = DATA / "venv"
    python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not python.exists():
        venv.create(environment, with_pip=True)
    subprocess.run([str(python), "-m", "pip", "install", "--only-binary=:all:", "-r",
                    str(ROOT / "services/local-tts/requirements.txt")], check=True)

    destination = DATA / MODEL
    marker = destination / ".verified-sha256"
    if marker.exists() and marker.read_text().strip() == MODEL_SHA256 and all(
        (destination / name).exists() for name in ["model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-zh.txt",
                                                  "lexicon-us-en.txt", "phone-zh.fst", "date-zh.fst", "number-zh.fst"]
    ):
        print("本地模型已安装，跳过下载。")
    else:
        print("下载 Kokoro 中文模型（约 140 MiB），首次安装需要联网……", flush=True)
        with tempfile.TemporaryDirectory(dir=DATA) as staging:
            archive = Path(staging) / "model.tar.bz2"
            with urllib.request.urlopen(MODEL_URL, timeout=60) as response, archive.open("wb") as output:
                shutil.copyfileobj(response, output)
            with archive.open("rb") as downloaded:
                digest = hashlib.file_digest(downloaded, "sha256").hexdigest()
            if digest != MODEL_SHA256:
                raise SystemExit("模型 SHA-256 校验失败，未安装。请重新运行 pnpm tts:setup。")
            with tarfile.open(archive, "r:bz2") as model:
                model.extractall(staging, filter="data")
            extracted = Path(staging) / MODEL
            if destination.exists():
                shutil.rmtree(destination)
            extracted.rename(destination)
            marker.write_text(MODEL_SHA256 + "\n")
    print("本地 TTS 安装完成。运行 pnpm tts:start 启动服务。")


if __name__ == "__main__":
    main()
