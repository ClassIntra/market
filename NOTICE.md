# NOTICE · 第三方素材与许可

本仓（market）内的应用包各自声明其第三方素材来源。本文件汇总需要署名/声明许可的部分。

---

## 拾光群岛（`apps/shiguang`）

### Ninja Adventure Asset Pack

- 作者：Pixel-boy（<https://pixel-boy.itch.io/>）与 AAA
- 来源：<https://pixel-boy.itch.io/ninja-adventure-asset-pack>
- 许可：**CC0 1.0 Universal（公有领域贡献）**
  <https://creativecommons.org/publicdomain/zero/1.0/>
- 本项目使用到的部分：角色与怪物精灵、守护者（Boss）动画、特效、道具图标、
  HUD 头像框、背景音乐（11 首）与音效（30 个）。
- 使用方式：打包为单张图集 `apps/shiguang/frontend/v5/atlas.png`（帧坐标见 `atlas.json`），
  音频原样保留在 `frontend/v5/music/` 与 `frontend/v5/sfx/`。

CC0 不要求署名，此处仍主动声明来源，以便追溯与致谢。

### 字体：Unifont EX

- 来源：GNU Unifont 项目（<https://unifoundry.com/unifont/>）及其 Unifont EX 衍生版本。
- 许可：**GPL-2.0-or-later，附带 Font Exception** —— 允许把字体嵌入文档与应用而
  不要求使用该字体的作品整体采用 GPL。
- 使用方式：仅作为 Web 字体随应用内嵌分发（`apps/shiguang/frontend/fonts/unifont-ex.woff2`），
  未修改字形内容。之所以不用系统字体：中文点阵在 <16px 下必然糊成一片。

### 程序绘制部分

`apps/shiguang` 中的地形纹理砖、树木/岩石/灌木精灵、房屋、灯塔、水面、光照、雾、
HUD 与面板样式均由本项目代码生成或手写，不含第三方素材。
