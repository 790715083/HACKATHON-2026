# 本地中文配音

配音由本机 CPU 上的 sherpa-onnx 2.0.0 + Kokoro v1.1-zh INT8 完成，服务默认监听 `127.0.0.1:8880`。Next.js 在服务端访问它，浏览器继续通过带会话检查的 `/api/tts` 播放已提交发言。

文本模型仍为 `glm-5.3-flash`，玩家录音转写仍为 `glm-asr-2512`。本地 TTS 不读取智谱 Key，不调用云端配音。

## 安装与运行

需要 Python 3.12+。在项目根目录执行：

```sh
pnpm tts:setup
pnpm tts:start
```

首次安装需要联网，从 PyPI 安装固定版本的预编译 CPU 依赖，从 sherpa-onnx 官方 Release 下载约 140 MiB 的模型压缩包，并校验 SHA-256。解压后的模型、词典和虚拟环境均保存在 `.data/tts/`，不提交到 Git。再次安装会复用已验证模型。合成阶段无需联网。

保持该终端开启，在另一个终端按 README 启动 Next.js。服务停止后，游戏会提示启动命令并暂停自动配音队列；启动服务后，点击发言的重播按钮可重试。文字对局可继续进行。

服务参数可直接传给启动命令：

```sh
pnpm tts:start --port 8881 --threads 2
```

使用不同端口时，在启动 Next.js 的环境中设置 `TTS_BASE_URL=http://127.0.0.1:8881/v1`。`TTS_MODEL` 默认 `kokoro-v1.1-zh`，应与服务一致。也可以把这两个变量写入项目根目录的 `.env.local`，修改后重启 Next.js。探测脚本读取进程环境变量，使用自定义端口时同样传入 `TTS_BASE_URL`。

## 配音与资源

模型以 24 kHz、单声道、16 位 PCM WAV 输出。按席位固定音色，主角名称和游戏身份不会影响音色选择；八位 AI 使用八种不同的中文声音，复盘使用旁白音色。

| 席位 | 人物 | 音色 | 模型 speaker ID |
| --- | --- | --- | --- |
| 0 | 旁白／复盘 | `zf_001` | 3 |
| 1 | 真人手动重播 | `zm_013` | 62 |
| 2 | 沈砚 | `zm_009` | 58 |
| 3 | 林雾 | `zf_002` | 4 |
| 4 | 许知夏 | `zf_003` | 5 |
| 5 | 陈渡 | `zm_010` | 59 |
| 6 | 苏晚 | `zf_004` | 6 |
| 7 | 顾行舟 | `zm_011` | 60 |
| 8 | 唐梨 | `zf_005` | 7 |
| 9 | 周予 | `zm_012` | 61 |

每次发言按不超过 300 个字符分段，播放器顺序播放所有段落。关闭配音、停止、暂停或录音会取消浏览器当前请求和播放；已开始的本机推理会完成当前段。服务同时只运行一次推理，忙时可稍后重播，避免多会话并行占用模型。音频缓存最多保留 24 段、总计 32 MiB。

服务本身只接受至多 1024 个字符、WAV 格式和受支持音色；请求内容不写入日志。不在游戏存档中保存音频。`.data/audit/` 下的音频仅由手动探测脚本生成。

## 验证

```sh
curl http://127.0.0.1:8880/health
pnpm tts:probe
pnpm tts:test
pnpm test
```

`tts:probe` 会通过应用使用的服务端适配器实际合成八位 AI 和旁白的中文，检查 WAV 采样率、声道和时长，将音频与耗时报告保存到 `.data/audit/local-tts*.wav` 和 `.data/audit/local-tts.json`。该探测不需要智谱 Key。

`tts:test` 验证本地 HTTP 协议、参数边界和并发上限，使用固定音频，不能代替真实模型合成与浏览器播放验收。

## 模型来源

- [Kokoro 官方模型卡](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)
- [sherpa-onnx Kokoro 模型和 INT8 下载说明](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html)
- [v1.1 中文音色与 speaker ID](https://k2-fsa.github.io/sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-v1_1.html)
- [sherpa-onnx Python CPU 安装](https://k2-fsa.github.io/sherpa/onnx/python/install.html)

模型随包附带的许可文件保留在下载目录。安装脚本固定压缩包 SHA-256 为 `a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6`。
