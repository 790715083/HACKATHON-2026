"""Install the local CPU runtime and pinned SenseVoice weights in .data/stt."""
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
DATA = ROOT / ".data" / "stt"
MODEL = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
MODEL_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{MODEL}.tar.bz2"
MODEL_SHA256 = "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e"
REQUIRED = ["model.int8.onnx", "tokens.txt", "test_wavs/zh.wav"]


def install_model(archive, destination):
    with archive.open("rb") as downloaded:
        digest = hashlib.file_digest(downloaded, "sha256").hexdigest()
    if digest != MODEL_SHA256:
        raise ValueError("模型 SHA-256 校验失败，未安装。请重新运行 pnpm stt:setup。")
    with tempfile.TemporaryDirectory(dir=DATA) as staging:
        with tarfile.open(archive, "r:bz2") as model:
            model.extractall(staging, filter="data")
        extracted = Path(staging) / MODEL
        if any(not (extracted / name).is_file() for name in REQUIRED):
            raise ValueError("模型归档不完整，未安装。")
        if destination.exists():
            shutil.rmtree(destination)
        extracted.rename(destination)
        (destination / ".verified-sha256").write_text(MODEL_SHA256 + "\n")


def main():
    if sys.version_info < (3, 12):
        raise SystemExit("本地 STT 需要 Python 3.12+。")
    DATA.mkdir(parents=True, exist_ok=True)
    environment = DATA / "venv"
    python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not python.exists():
        venv.create(environment, with_pip=True)
    subprocess.run([str(python), "-m", "pip", "install", "--only-binary=:all:", "-r",
                    str(ROOT / "services/local-stt/requirements.txt")], check=True)
    destination = DATA / MODEL
    marker = destination / ".verified-sha256"
    if marker.is_file() and marker.read_text().strip() == MODEL_SHA256 and all(
        (destination / name).is_file() for name in REQUIRED
    ):
        print("本地识别模型已安装，跳过下载。")
    else:
        print("下载 SenseVoice INT8 模型（约 155 MiB），首次安装需要联网……", flush=True)
        with tempfile.TemporaryDirectory(dir=DATA) as staging:
            archive = Path(staging) / "model.tar.bz2"
            with urllib.request.urlopen(MODEL_URL, timeout=60) as response, archive.open("wb") as output:
                shutil.copyfileobj(response, output)
            install_model(archive, destination)
    print("本地 STT 安装完成。运行 pnpm stt:start 启动服务。")


if __name__ == "__main__":
    main()
