# 可选组件与来源

主程序只包含组件管理、调用接口和语言包目录，不内置 OCR/翻译模型。组件由用户在“设置 → 组件集成”选择安装，保存在数据目录的 `components` 下。使用时在主进程加载，任务结束释放模型和 DLL。

## 参考项目

- SnowAir：<https://github.com/CM-idea/SnowAir>，参考版本 `0345a08ce131d9effabcd41e247c5c5a5edaa336`，Apache-2.0。参考组件名称、公共 C 接口调用方式和语言包目录；界面沿用当前 Cubby 派生项目的组件。
- 本项目原有 Cubby / LaterScreen 来源及许可见 `LICENSE-NOTICES.md`。

## OCR

- lw.PPOCR.C v1.2.0：<https://github.com/lxw112190/lw.PPOCR.C/releases/tag/v1.2.0>。
- Windows x64 MSVC 运行库，以及 PP-OCRv6 tiny / small 模型包。下载校验发布资产对应的 SHA-256。
- 安装器保留运行包和模型包中以 LICENSE、COPYING、NOTICE、copyright 开头的许可文件；组件与模型适用各自发布包的许可。
- 不替换 Windows 系统 DLL；只解出组件 DLL 和相应 MSVC 运行库文件。

## 离线翻译

- BergamotTranslatorSharp 0.5.1 原生 Windows x64 运行库：<https://www.nuget.org/packages/BergamotTranslatorSharp/0.5.1>。
- Firefox Translations 模型目录来自上述固定 SnowAir 版本，资源从 Mozilla 的 `moz-fx-translations-data--303e-prod-translations-data` 存储桶下载。
- 可选中英、繁中英、日英、韩英、俄英、法英、西英、德英双向包；非英语之间使用已安装的英语模型中转。
- 翻译文本和待识别图片在本地处理；组件下载本身需要联网。语言包和运行库的许可由各自上游提供，安装器保留压缩包中随附的许可文件。

## 外部图片查看器

用户选择已有查看器的 EXE。本程序将指定历史图片导出为 PNG 后作为文件参数打开，不捆绑或重新分发果核看图等第三方软件。导出目录位于数据目录的 `capture-exports`，导出的图片是普通 PNG 文件。
