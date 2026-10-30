# 帧匣 Zhenxia

Windows 剪贴板历史、截图与标注工具。以 Cubby 为主体，整合 LaterScreen Rust 引擎，并参考轻雪的截图与贴图工作流。

**当前版本：0.2.1。** 支持中文和英文。项目仍在完善，已有功能不代表与轻雪的全部能力一致。

## 下载与运行

从 [Releases](https://github.com/YunxiQWQ/zhenxia/releases) 下载安装版 `Zhenxia-0.2.1-windows-x64-setup.exe`，安装后可在“设置 → 常规 → 开机启动”开启登录 Windows 时自动运行。默认不自动开启。安装版数据保存在 `%APPDATA%\Zhenxia`，卸载保留历史数据。

也可下载 Windows x64 便携包，解压后运行 `Zhenxia.exe`。便携版的开机启动设置保持禁用；需要开机启动请使用安装版。保留同目录的 `portable.txt` 和 `data`；更新时退出程序、替换程序文件，保留原 `data`。不要同时运行多个替代 Win+V 的剪贴板程序。

已在 Windows 11 x64 验证；界面使用系统 WebView2 Runtime。发行包未做代码签名，不包含可选 OCR/翻译模型。

## 主要功能

- **统一剪贴板历史**：Win+V、文字/图片/文件筛选、搜索、备注、置顶和图片编辑。
- **截图与标注**：默认 F1 框选，松手确定；矩形、箭头、画笔、文字、序号、高亮、马赛克，支持保存、复制和贴图。
- **长截图**：从托盘或历史面板的“截图工具”进入，框选后在原页面手动向下滚动，程序自动捕获和拼接。每次保留至少一半重叠；支持手动捕获、暂停自动采集、撤销上一张、完成后编辑并进入历史。匹配失败保留已有结果。限高 30000 像素且最多 4800 万像素。
- **录屏**：选择区域后录制 MP4 或 GIF，支持暂停、继续、取消和停止保存。**当前只录屏幕画面，不录音频**。完成后在“设置 → 截图历史 → 录屏”导出。单次最多 30 分钟或 512 MB，GIF 区域最多约 210 万像素。
- **实时演示画布**：在实时桌面上绘制，支持颜色、粗细、渐隐、撤销、清空和鼠标穿透。穿透后通过托盘的“演示画布 / 恢复演示操作”恢复控制；Esc 或退出按钮关闭。
- **水印**：图片编辑器中的水印按钮提供文字/图片水印、透明度、大小、角度、位置和平铺；实时预览，可取消、撤销与重做，预览和 PNG 导出使用同一绘制链路。
- **贴图与图片编辑**：拖动、缩放、透明度、置顶；编辑器支持裁剪、旋转、翻转、撤销/重做与导出。
- **OCR / 离线翻译**：Windows OCR 和可选 PP-OCRv6、Firefox/Bergamot 语言包，按需下载。
- **快捷键和外观**：全局/局部改键、冲突反馈、工具栏拖动排序、隐藏工具、主题、窗口材质与圆角。

长截图、录屏和演示画布也可在“设置 → 快捷键”分配全局键位。已有 F1、Win+V 和用户自定义键位保留；系统占用时会提示冲突。

## 数据与资源

剪贴板历史和完成保存的媒体位于本地数据目录。录屏活动期间使用临时文件，正常取消或完成后清理；完成的录屏分块加密保存，只有主动导出时生成普通视频文件。异常退出可能留下 `recordings/active-*` 临时文件，可在关闭程序后检查数据目录。

截图、长截图、录屏编码和拼接在应用进程内完成；不启动 SnowAir、LaterScreen、FFmpeg 或 gifski 程序。界面仍由 Tauri/WebView2 提供，系统会创建相应的 WebView2 进程。新面板按需创建，关闭后释放；待机时不持续录制或轮询桌面图像。

## 构建

需要 Windows、Visual Studio C++ Build Tools 与 Windows SDK、Rust stable、Node.js 24 和 pnpm。

```powershell
pnpm install --frozen-lockfile
pnpm build
cargo build --release --locked --manifest-path src-tauri/Cargo.toml --bin cubby
```

生成当前用户安装包（附许可证与依赖声明，不需要管理员安装应用）：

```powershell
Copy-Item src-tauri/target/release/cubby.exe src-tauri/target/release/Zhenxia.exe
pnpm tauri bundle --bundles nsis --no-sign --no-binary-patching --ci
```

安装包输出在 `src-tauri/target/release/bundle/nsis/`。安装版与便携版不支持数据迁移，历史记录不互通。

输出为 `src-tauri/target/release/cubby.exe`，可重命名为 `Zhenxia.exe`。内部 crate 名沿用 Cubby；应用标识为独立的 `local.yunxi.zhenxia`。要使用便携存储，在程序旁放一个空的 `portable.txt`。

```powershell
pnpm test -- --maxWorkers=2
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1
```

原生完整测试包含 Windows 桌面/编码能力；无桌面的服务器和 Windows N 的媒体组件可能不同。首次构建需要联网取得锁定的依赖。可选 OCR/翻译组件不是构建必需项。

## 当前边界

长截图当前为向下滚动模式；快速大幅滚动、动画或视频区域可能无法可靠匹配，界面会提示重试。更多混合 DPI 多屏场景仍需验收。

截图态、完整编辑器和贴图的标注模型还未全部统一；截图态的马赛克预览仍有待改进。导出和重新打开的是扁平图片，原标注对象没有跨会话保存。更细的元素吸附、完整贴图操作、二维码、包浆、镜像、AI 和超级动作等不属于本次四项扩展。

## 开源协议与鸣谢

整体以 **GPL-3.0-only** 发布，详见 [LICENSE](LICENSE)。保留以下上游的版权与原许可证：

| 上游 | 许可证 | 使用方式 |
| --- | --- | --- |
| [Cubby Clipboard](https://github.com/btsouth/cubby-clipboard) | GPL-3.0 | 主体应用的修改版 |
| [PastePaw](https://github.com/XueshiQiao/PastePaw) | GPL-3.0 | Cubby 的原始上游 |
| [LaterScreen](https://github.com/crazykun/LaterScreen) | MIT | 内嵌 Rust 截图、图元和渲染引擎 |
| [SnowAir 轻雪](https://github.com/CM-idea/SnowAir) | Apache-2.0 | 界面与工作流参考，保留相关材料声明 |

更多说明和固定来源版本见 [LICENSE-NOTICES.md](LICENSE-NOTICES.md)、[NOTICE.md](NOTICE.md)、[NOTICE-SnowAir.txt](NOTICE-SnowAir.txt)、[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。可选组件来源见 [OPTIONAL-COMPONENTS.md](OPTIONAL-COMPONENTS.md)。本项目不包含轻雪未公开的定制 Ling，也不代表任何上游作者认可本项目。
