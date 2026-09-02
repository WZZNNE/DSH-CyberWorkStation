@echo off
rem ============================================================
rem  DSH Suite one-click setup
rem  1. Use the bundled core/ source tree (falls back to cloning upstream)
rem  2. Install dependencies and build lib + web frontend
rem  3. Register every suite plugin into the web / headless profiles
rem  4. Link the core packages the plugins import (peer links)
rem  5. Start the DSH Launcher
rem  Prerequisites: Git, Node.js ^22.19 or >=24 (corepack enable provides pnpm)
rem ============================================================
setlocal
chcp 65001 >nul
set SUITE=%~dp0
rem The bundle ships core\ (the dsh source tree); without it, clone the upstream tag this
rem suite was verified against into deepseek-harness\ (keep CORE_TAG in step with CHANGELOG.md).
set CORE=%SUITE%core
set CORE_TAG=dsh-v0.1.1-rc.2
if not exist "%CORE%\package.json" set CORE=%SUITE%deepseek-harness

echo [1/6] 检查环境...
where git >nul 2>nul || (echo 缺少 Git,请先安装 https://git-scm.com/ && exit /b 1)
where node >nul 2>nul || (echo 缺少 Node.js,请先安装 https://nodejs.org/ && exit /b 1)
rem The core's engines field is ^22.19.0 || >=24.0.0 (23.x excluded); fail here instead of deep inside pnpm install.
for /f "tokens=1,2 delims=.v" %%a in ('node -v') do (set NODE_MAJOR=%%a& set NODE_MINOR=%%b)
set NODE_OK=0
if %NODE_MAJOR% GEQ 24 set NODE_OK=1
if %NODE_MAJOR% EQU 22 if %NODE_MINOR% GEQ 19 set NODE_OK=1
if %NODE_OK% EQU 0 (echo Node.js 版本需为 22.19+ 或 24+,建议 24 LTS;当前 %NODE_MAJOR%.%NODE_MINOR% && exit /b 1)
call corepack enable 2>nul

echo [2/6] 获取 deepseek-harness 本体...
if exist "%CORE%\package.json" (
  echo   已内置(%CORE%),跳过克隆
) else (
  git clone --depth 1 --branch %CORE_TAG% https://github.com/deepseek-ai/deepseek-harness.git "%CORE%" || exit /b 1
)

echo [3/6] 安装依赖并构建(首次约 5-10 分钟)...
pushd "%CORE%"
call corepack pnpm install || (popd && exit /b 1)
rem Since rc.8 the web frontend depends on the built lib face; build:lib must run first.
rem The launcher also boots the core from the built CLI (apps/cli/lib/bin.js), which is ~10x faster than the tsx source launch.
call corepack pnpm build:lib || (popd && exit /b 1)
call corepack pnpm build:web || (popd && exit /b 1)

echo [4/6] 注册套件插件到 web profile...
rem `dsh plugin` forwards to a bare `pnpm` on PATH; when corepack enable could not run
rem (unelevated shell) use the source launch, where pnpm puts itself on PATH.
set DSHCLI=node apps\cli\lib\bin.js
where pnpm >nul 2>nul || set DSHCLI=corepack pnpm dsh
for %%P in (dsh-safe-guard dsh-cost-meter-plus dsh-skin-loader dsh-control-deck dsh-price-hint dsh-quick-workspace dsh-skin-studio dsh-local-reasoning dsh-web-search-plus dsh-memory-lite dsh-chat-editor dsh-temp-chat dsh-media-lab dsh-desktop-pet dsh-lan-fence dsh-credentials-keyring dsh-provider-sync dsh-vision-bridge-zh dsh-drop-files dsh-credentials-center dsh-import-note) do (
  echo   + %%P
  call %DSHCLI% plugin --profile web add "link:%SUITE%plugins\%%P"
)
rem dsh-credentials-keyring and dsh-lan-fence carry no bundle patch on purpose (one replaces the
rem stock credentials provider, the other edits the connection fence in place): they are layers of
rem the profile's own cordis.patch.yml. The helper appends the entries once, idempotently.
echo   (dsh-credentials-keyring / dsh-lan-fence: "installed as a plain dependency" above is expected — they are registered as patch layers next)
call node "%SUITE%launcher\dsh-patch-layers.mjs"
rem The headless profile only mounts billing and the Control Deck.
call %DSHCLI% plugin --profile headless add "link:%SUITE%plugins\dsh-cost-meter-plus" 2>nul
call %DSHCLI% plugin --profile headless add "link:%SUITE%plugins\dsh-control-deck" 2>nul
popd

rem link: plugins ship their own third-party dependencies (zod for cost-meter)
pushd "%SUITE%plugins\dsh-cost-meter-plus"
call corepack pnpm install
popd

echo [5/6] 链接插件所需的本体包(peer links)...
set DSH_REPO=%CORE%
call node "%SUITE%launcher\peer-links.mjs"

rem The in-dsh skills (skin studio, control deck authoring, desktop pet) go into the user skill root.
if not exist "%USERPROFILE%\.dsh\skills\skin-studio" mkdir "%USERPROFILE%\.dsh\skills\skin-studio"
copy /y "%SUITE%dsh-skills\skin-studio\SKILL.md" "%USERPROFILE%\.dsh\skills\skin-studio\SKILL.md" >nul
if not exist "%USERPROFILE%\.dsh\skills\control-deck-authoring" mkdir "%USERPROFILE%\.dsh\skills\control-deck-authoring"
copy /y "%SUITE%dsh-skills\control-deck-authoring\SKILL.md" "%USERPROFILE%\.dsh\skills\control-deck-authoring\SKILL.md" >nul
if not exist "%USERPROFILE%\.dsh\skills\desktop-pet" mkdir "%USERPROFILE%\.dsh\skills\desktop-pet"
copy /y "%SUITE%dsh-skills\desktop-pet\SKILL.md" "%USERPROFILE%\.dsh\skills\desktop-pet\SKILL.md" >nul

echo [6/6] 启动 DSH 启动器...
set DSH_REPO=%CORE%
start "" "%SUITE%launcher\DSH启动器.exe"
echo.
echo 完成!启动器窗口即将打开(手动模式:node launcher\server.mjs 后访问 http://127.0.0.1:3090)
echo 别忘了配置 API Key:启动器「凭据中心」页(或 dsh 设置 → 凭据中心)里填 OPENROUTER_API_KEY;密钥只进 dsh 的凭据库,不写 settings.yaml。
endlocal
