# 本地玩家语音识别

玩家点击「语音发言」，允许麦克风权限后开始录音，再点击「结束录音」。每段最长 30 秒，识别结果追加到发言草稿，仍需编辑确认并点击「结束发言」才会提交。录音、打开麦克风和转写都可以取消；暂停、返回大厅或切换发言回合会取消旧录音。录音前会停止 AI 配音，以减少回声。

默认 `STT_PROVIDER=local`，音频由本机的 SenseVoiceSmall INT8 模型识别，不需要语音 API Key。本地服务未启动时提示启动命令，不自动改用云端。录音按钮旁会显示「本机识别」或「外部识别」，对应服务端选择。

## 安装和启动

需要 Python 3.12+，与本地 TTS 相同；使用独立虚拟环境，不需要 GPU、Docker 或 FFmpeg。Node.js 和 pnpm 要求见仓库 README。

```sh
pnpm stt:setup
# 在独立终端保持运行：
pnpm stt:start
```

首次安装下载约 155 MiB 的模型归档，并通过代码中固定的 SHA-256 校验；解压后的 INT8 ONNX 约 228 MiB。模型及 Python 运行时保存在 Git 忽略的 `.data/stt/`。重复 setup 会复用已安装模型；模型和运行时完整后，识别过程离线运行。游戏中的 AI 文本对局仍需要智谱 Key，配音仍使用独立的本地 TTS。

默认服务地址为 `http://127.0.0.1:8881`，仅监听本机：

```sh
curl http://127.0.0.1:8881/health
# {"status":"ok","model":"sensevoice-small-int8","device":"cpu"}

pnpm stt:probe
# 也可以使用自己的 16 位 PCM WAV（0.2–30 秒）：
pnpm stt:probe /absolute/path/to/speech.wav
```

默认 probe 使用模型自带的公开中文样本，检查识别包含原句关键内容，报告写入 `.data/audit/local-stt.json`。浏览器上传的玩家录音仅在内存处理，不写入音频文件、游戏存档或请求日志；只有确认提交的文字进入对局历史。probe 是显式验收命令，会在报告中保存样本路径及转写结果。

需要更改端口或 CPU 并行度时：

```sh
pnpm stt:start --port 9001 --threads 2
# 启动 Next.js 的终端同时设置：
export STT_BASE_URL=http://127.0.0.1:9001/v1
pnpm dev
```

## 提供方与外部 API

所有配置均在服务端环境设置，修改后重新启动 Next.js。不要使用 `NEXT_PUBLIC_` 保存凭据。前端只获取提供方标签和模型名，不获取 API Key 或服务 URL。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `STT_PROVIDER` | `local` | `local`、`zhipu` 或 `external`，必须显式选择外部服务 |
| `STT_BASE_URL` | local 下为 `http://127.0.0.1:8881/v1` | 不包含 `/audio/transcriptions`；external 下必须设置 |
| `STT_MODEL` | local 下为 `sensevoice-small-int8` | external 下必须设置为服务支持的模型 |
| `STT_API_KEY` | 未设置 | 仅 external 使用的 Bearer Key；支持无鉴权的自托管兼容服务 |
| `ZHIPU_STT_MODEL` | `glm-asr-2512` | 仅 zhipu 使用，复用 `ZHIPU_API_KEY` 和 `ZHIPU_BASE_URL` |

`local` 只接受 localhost 或 loopback IP 地址。若要把录音交给远程服务器，需显式设置 `external`。提供方失败时不会自动切换或重复上传录音。

### 使用已有智谱识别

```sh
export STT_PROVIDER=zhipu
export ZHIPU_STT_MODEL=glm-asr-2512
# ZHIPU_API_KEY 和 ZHIPU_BASE_URL 沿用文本对局的服务端配置。
pnpm dev
```

### 使用通用外部识别接口

```sh
export STT_PROVIDER=external
export STT_BASE_URL=https://your-stt-host.example/v1
export STT_MODEL=your-transcription-model
# 使用进程环境、密钥管理器或隐藏输入注入 STT_API_KEY。
pnpm dev
```

适配器向 `${STT_BASE_URL}/audio/transcriptions` 发送 `multipart/form-data`，包含 `file`（WAV）、`model`、`language=zh`、`response_format=json` 和狼人杀术语 `prompt`。返回格式须为 `{"text":"识别结果"}`。这是兼容 OpenAI 风格的接口约定，不依赖 OpenAI SDK；返回 URL、流式 SSE 或其他供应商专用协议的接口需要增加适配器。智谱提供方保持原来的 `stream=false` 协议，不发送通用接口专用的 language/response_format 字段。

服务端等待上限为 120 秒，用户取消会中断 HTTP 请求。本地 CPU 已开始的推理可能继续至完成，服务同时只接受一段录音；遇到忙碌提示请稍后重录。外部接口 HTTP 失败、鉴权失败、空转写及无效 JSON 都会显示可操作提示，不把服务端原始错误内容发送给浏览器。

## 模型与识别边界

- 运行时固定为 sherpa-onnx 2.0.0，模型是 SenseVoiceSmall 的 INT8 ONNX 版本，使用中文识别和 ITN 标点/数字规范化。
- 本地接口接受单声道或双声道、8–192 kHz 的 16 位 PCM WAV，并由运行时处理采样率；浏览器优先采集 16 kHz 单声道。
- SenseVoice 接口不支持本项目的动态术语热词提示；本地识别不做术语猜测或文字润色，玩家可在草稿中修正。外部接口可使用 `prompt`。
- 麦克风需要浏览器的安全上下文（本机 localhost/127.0.0.1 或 HTTPS）和用户授权。无法访问麦克风时仍可打字。
- 这次集成提供录音完成后的整段转写，不提供实时逐字字幕。噪声、口音和专有名字会影响准确率，结果始终经过玩家确认。

模型与调用来源：[SenseVoice 预训练模型说明](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html)、[sherpa-onnx 2.0.0 Python 示例](https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.0/python-api-examples/offline-sense-voice-ctc-decode-files.py)。模型归档保留上游许可证。
