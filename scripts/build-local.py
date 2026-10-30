"""Build an unsigned portable package using the caller's installed toolchain."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
env = os.environ.copy()
if not env.get('VSCMD_VER'):
    finder = Path(env.get('ProgramFiles(x86)', 'C:/Program Files (x86)')) / 'Microsoft Visual Studio/Installer/vswhere.exe'
    if not finder.is_file():
        raise SystemExit('Run from an x64 Native Tools prompt, or install Visual Studio C++ Build Tools.')
    install = subprocess.check_output([str(finder), '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], encoding='utf-8').strip()
    vcvars = Path(install) / 'VC/Auxiliary/Build/vcvars64.bat'
    if not install or not vcvars.is_file():
        raise SystemExit('Visual Studio C++ x64 tools were not found.')
    setup = subprocess.run(['cmd.exe', '/d', '/s', '/c', f'call "{vcvars}" >nul && set'], capture_output=True, check=True)
    for line in setup.stdout.decode('mbcs', errors='replace').splitlines():
        if '=' in line and not line.startswith('='):
            key, value = line.split('=', 1)
            env[key] = value
env.setdefault('CARGO_BUILD_JOBS', '6')
env['CARGO_TARGET_DIR'] = str(root / 'src-tauri/target')
for args, cwd in [
    (['node', 'node_modules/typescript/bin/tsc'], root),
    (['node', 'node_modules/vite/bin/vite.js', 'build'], root),
    (['cargo', 'build', '--release', '--locked'] + (['--offline'] if '--offline' in sys.argv else []), root / 'src-tauri'),
]:
    subprocess.run(args, cwd=cwd, env=env, check=True)
out = root / 'build/portable'
out.mkdir(parents=True, exist_ok=True)
shutil.copy2(root / 'src-tauri/target/release/cubby.exe', out / 'Zhenxia.exe')
(out / 'portable.txt').touch()
for name in ['README.md', 'LICENSE', 'LICENSE-LaterScreen.txt', 'LICENSE-SnowAir.txt', 'NOTICE.md', 'NOTICE-SnowAir.txt', 'LICENSE-NOTICES.md', 'THIRD-PARTY-NOTICES.txt', 'OPTIONAL-COMPONENTS.md']:
    shutil.copy2(root / name, out / name)
shutil.copytree(root / 'LICENSES', out / 'LICENSES', dirs_exist_ok=True)
print(f'Portable build: {out}')
