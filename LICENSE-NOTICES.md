# Zhenxia: license and upstream attribution

Zhenxia is a modified combined work distributed under **GPL-3.0-only**. The full license is in `LICENSE`. Copyright and license notices for upstream code remain applicable. Corresponding source, lockfiles and build instructions are provided in this repository and alongside binary releases.

| Project | License | Source and provenance | Use |
| --- | --- | --- | --- |
| Cubby Clipboard | GPL-3.0 | https://github.com/btsouth/cubby-clipboard ; snapshot `bb14d634a6cfa0074a3c307e3976b9cd4f7a5814` | Modified Windows clipboard application, settings, storage and integration |
| PastePaw, by Xueshi Qiao | GPL-3.0 | https://github.com/XueshiQiao/PastePaw ; Cubby's fork point `c05a4f849dbfd30c8143a891276df624a7e248b4` | Original upstream of Cubby; see `NOTICE.md` |
| LaterScreen, copyright 2026 Mi Ji | MIT | https://github.com/crazykun/LaterScreen ; snapshot `5a0ca2227bc02f53333fb62fa0b56e216a80ed4c` | Vendored, modified `lscreen-core` and `lscreen-capture` engines; full MIT text in `LICENSE-LaterScreen.txt` and `src-tauri/engines/LICENSE-LaterScreen` |
| SnowAir, by Liuyiran / CM-idea | Apache-2.0 | https://github.com/CM-idea/SnowAir ; reference settings snapshot `0345a08ce131d9effabcd41e247c5c5a5edaa336` | Interface and workflow reference, including attribution for inherited reference material; `LICENSE-SnowAir.txt` |
| Microsoft PowerToys | MIT | https://github.com/microsoft/PowerToys | Behavioral reference for Cubby's independently implemented Win+V mapping; see `NOTICE.md` |

The application does not include or launch SnowAir's executable, Qt, its unpublished custom Ling implementation, or the LaterScreen application executable. Only the vendored Rust engines listed above are compiled into Zhenxia.

## Recording implementation

MP4 encoding calls Windows Media Foundation, a system API. GIF encoding uses the MIT/Apache-licensed `image`/`gif` Rust libraries. **gifski and FFmpeg are not linked or bundled.** The previous conditional gifski/AGPL note does not describe this implementation. There is no separately installed recording daemon or encoder process.

## Other dependencies

`THIRD-PARTY-NOTICES.txt` contains the resolved Windows Cargo graph and installed frontend runtime dependency notices, with versions, declared licenses and available license texts. `src-tauri/Cargo.lock` and `pnpm-lock.yaml` record the dependency versions. Build tools retain their own licenses.

Optional OCR/translation engines and models are downloaded only when requested; they are not included in the main executable or portable ZIP. Their sources and licensing are described in `OPTIONAL-COMPONENTS.md`. Their original license terms still apply when installed or redistributed separately.

## Distribution policy

The combined application remains GPL-3.0-only; MIT, BSD, Apache-2.0, MPL-2.0 and other compatible dependency notices are retained rather than replaced. Apache-2.0 compatibility with GPLv3 is described by the [Apache Software Foundation](https://www.apache.org/licenses/GPL-compatibility.html). The GPL does not remove the upstream copyright, attribution or source obligations.

Zhenxia is an independent fork. Attribution does not imply endorsement by upstream authors. This repository starts from attributed source snapshots; the upstream Git histories remain available at their original repositories.

## Installer components

The Windows installer uses the unmodified NSIS 3.13 installer stub and built-in plug-ins with zlib compression, under the applicable zlib/libpng terms. The complete upstream module license notice is preserved in `LICENSES/installer/NSIS-3.13-COPYING.txt`. NSIS source and releases: https://nsis.sourceforge.io/Download .

The installer also contains the unmodified `nsis_tauri_utils.dll` v0.5.3 from https://github.com/tauri-apps/nsis-tauri-utils/tree/nsis_tauri_utils-v0.5.3 , used under its MIT option. Its copyright and license are preserved in `LICENSES/installer/nsis-tauri-utils-0.5.3-MIT.txt`. These installer components retain their original licenses; the Zhenxia application remains GPL-3.0-only.
