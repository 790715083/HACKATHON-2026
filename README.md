# 月下疑局 · Moonlit Verdict

一个人与八名 AI 围桌而坐的中文狼人杀游戏。原创月夜雾林场景、人物插画和界面，使用 GLM 生成玩家发言与决策，规则由服务端确定性引擎执行。玩法灵感来自 [Wolfcha](https://github.com/oil-oil/wolfcha)，本项目独立实现。

## 本地运行

需要 Node.js 22+、pnpm 11、Python 3.12+ 和智谱标准模型 API Key。AI 配音使用本地 Kokoro 中文模型，文本对局与录音识别使用智谱。

```sh
pnpm install
# 首次安装配音依赖和模型（约 140 MiB 模型下载）：
pnpm tts:setup
# 在单独的终端运行，保持服务开启：
pnpm tts:start
```

再打开一个终端启动游戏：

```sh
# 在 zsh 中隐式输入密钥，不会写入命令历史或源码：
read -rs "ZHIPU_API_KEY?请输入智谱 API Key："
export ZHIPU_API_KEY
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。不配置密钥也可查看首页和规则，真实 AI 对局需要服务端密钥。服务默认只监听本机。

也可以通过标准进程环境注入 `ZHIPU_API_KEY`，或运行 `node scripts/secure-dev.mjs` 后通过 stdin 输入密钥。环境变量的占位示例见 [.env.example](.env.example)。不要使用 `NEXT_PUBLIC_` 变量存放密钥。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `ZHIPU_API_KEY` | 必填 | 仅服务端使用的标准 API 凭据 |
| `ZHIPU_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 智谱服务地址 |
| `ZHIPU_CHAT_MODEL` | `glm-5.3-flash` | 发言、行动与复盘 |
| `ZHIPU_STT_MODEL` | `glm-asr-2512` | 玩家录音转写 |
| `TTS_BASE_URL` | `http://127.0.0.1:8880/v1` | 仅服务端连接的本地配音地址 |
| `TTS_MODEL` | `kokoro-v1.1-zh` | 本地中文配音模型 |

本地 TTS 使用 sherpa-onnx 在 CPU 上运行 Kokoro v1.1-zh INT8，无需 GPU、Docker 或配音 API Key。模型和 Python 虚拟环境保存在忽略的 `.data/tts/`，下载完成后合成过程离线运行。八名 AI 各自保持固定的中文音色。详细部署、验证和故障处理见 [本地 TTS](docs/LOCAL_TTS.md)。

## 怎么玩

选择身份或随机入席。九人配置为三名狼人、三名村民、预言家、女巫和猎人，只有一名真人。AI 各自保持固定人物性格，只能看到其身份允许的信息。

- 夜晚狼人交流并选刀，女巫用药、预言家查验。狼人平票时根据保存的随机种子决胜。
- 女巫各有一瓶解药和毒药，同夜最多用一瓶；仅首夜可自救，解药不能解除毒药。
- 天亮后轮流发言，再公开放逐票型。允许弃票，不能自投。最高票平票者 PK 一次，其余存活玩家复投，再平票则无人被放逐。
- 首夜遇害者和白天被放逐者可以遗言。猎人死亡后可开枪或放弃，被毒死时不能开枪。
- 全部狼人出局则好人获胜；全部村民或全部神职出局则狼人获胜。先结算猎人等连锁行动再判胜，同时满足双方条件为平局。
- 真人出局后继续观战；终局才统一公开所有身份和复盘。本版没有警长。

玩家可以打字，也可以每次录制最长 30 秒的语音。录音会编码为 WAV，识别结果放入草稿，确认后才作为发言提交。AI 配音可关闭、停止或重播；录音时停止配音以避免回声。

右上角的文字大小按钮可以切换标准／放大字号，并记住选择。对局手记支持按天数、玩家回查发言与完整票型；展开“个人标记”可记录怀疑、信任和对方声称的身份。标记按对局保存在当前浏览器，只代表你的判断。翻阅旧记录时，新发言不会打断阅读，点击“回到最新”即可继续跟随。手机底部提供当前行动入口，投票、查验和用药会在确认按钮上显示具体目标。

## 状态与接口

Next.js App Router / TypeScript / React / Tailwind CSS。规则和角色知识保存在 `src/lib/game`，服务端存储与模型适配位于 `src/lib/server`，界面只接收已过滤的真人视图。

| 接口 | 行为 |
| --- | --- |
| `GET /api/game` | 获取本地会话的真人可见状态及模型配置状态 |
| `POST /api/game` | 创建九人局；可指定 `preferredRole` 和 `name` |
| `POST /api/game/actions` | 提交带 `revision`、`turnId` 和 `actionId` 的真人操作，或暂停／恢复 |
| `POST /api/game/advance` | SSE 顺序推进 AI 至下一真人回合或终局 |
| `POST /api/tts` | 为当前对局已提交且可见的发言生成音频 |
| `POST /api/stt` | 将浏览器编码的 WAV 录音转为可编辑文本 |

HttpOnly 会话 Cookie 关联本地存档。完整检查点以原子写入保存在忽略的 `.data/` 目录，刷新和服务重启会从已完成的行动恢复。密钥不在存档中。不同角色的私密事件不会发送到其他玩家的浏览器或 AI 上下文。模型的 `reasoning_content` 不展示、不配音。

该版本面向本地个人使用，不包含登录、付费、云部署和真人联机。

## 验证

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm start
```

开发服务器运行时，可用独立验收会话执行一局真实 AI 游戏（不会接管浏览器的游戏），报告保存在忽略的 `.data/audit/full-game.json`：

```sh
pnpm audit:live
```

`pnpm tts:probe` 不需要 Key，可验证本地中文多音色合成并输出 WAV。`node scripts/provider-probe.mjs` 可通过 stdin 接收 Key，联合探测智谱文本、本地配音及智谱识别；标准输入必须保持打开，并先启动本地 TTS。文本模型和语音识别按智谱实际用量计费，TTS 在本机合成。

本次实现的具体检查结果及已知限制见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。

布局、阅读和行动反馈改进的检查结果见 [交互改进验收](docs/GAMEPLAY_UX_VERIFICATION.md)。
