@echo off
rem ============================================================
rem  DSH Suite 一键安装
rem  1. 克隆上游 deepseek-harness 本体(约 1.5GB,不随包分发)
rem  2. 安装依赖并构建 Web 前端
rem  3. 把套件全部插件注册进 web / headless profile
rem  4. 启动 DSH 启动器
rem  前置:Git、Node.js >= 18(会自动 corepack enable 获得 pnpm)
rem ============================================================
setlocal
chcp 65001 >nul
set SUITE=%~dp0
rem 整合包自带 core\(本体源码);没有时回退克隆到 deepseek-harness\
set CORE=%SUITE%core
if not exist "%CORE%\package.json" set CORE=%SUITE%deepseek-harness

echo [1/5] 检查环境...
where git >nul 2>nul || (echo 缺少 Git,请先安装 https://git-scm.com/ && exit /b 1)
where node >nul 2>nul || (echo 缺少 Node.js,请先安装 https://nodejs.org/ && exit /b 1)
call corepack enable 2>nul

echo [2/5] 获取 deepseek-harness 本体...
if exist "%CORE%\package.json" (
  echo   已内置(%CORE%),跳过克隆
) else (
  git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git "%CORE%" || exit /b 1
)

echo [3/5] 安装依赖并构建(首次约 5-10 分钟)...
pushd "%CORE%"
call corepack pnpm install || (popd && exit /b 1)
rem rc.8 起 web 前端依赖 lib 构建面,必须先 build:lib
call corepack pnpm build:lib || (popd && exit /b 1)
call corepack pnpm build:web || (popd && exit /b 1)

echo [4/5] 注册套件插件到 web profile...
for %%P in (dsh-safe-guard dsh-cost-meter-plus dsh-token-usage-plus dsh-skin-loader dsh-control-deck dsh-price-hint dsh-quick-workspace dsh-skin-studio) do (
  echo   + %%P
  call corepack pnpm dsh plugin --profile web add "link:%SUITE%plugins\%%P"
)
rem headless profile 只挂计费与控制甲板
call corepack pnpm dsh plugin --profile headless add "link:%SUITE%plugins\dsh-cost-meter-plus" 2>nul
call corepack pnpm dsh plugin --profile headless add "link:%SUITE%plugins\dsh-control-deck" 2>nul
popd

rem link: 插件需要自带依赖
pushd "%SUITE%plugins\dsh-cost-meter-plus"
call corepack pnpm install
popd

rem dsh 内 skill(皮肤工坊工艺文档)装入用户 skill 根
if not exist "%USERPROFILE%\.dsh\skills\skin-studio" mkdir "%USERPROFILE%\.dsh\skills\skin-studio"
copy /y "%SUITE%dsh-skills\skin-studio\SKILL.md" "%USERPROFILE%\.dsh\skills\skin-studio\SKILL.md" >nul

echo [5/5] 启动 DSH 启动器...
set DSH_REPO=%CORE%
start "" "%SUITE%launcher\DSH启动器.exe"
echo.
echo 完成!启动器窗口即将打开(手动模式:node launcher\server.mjs 后访问 http://127.0.0.1:3090)
echo 别忘了在环境变量或 ~\.dsh\settings.yaml 里配置你的 API Key(如 OPENROUTER_API_KEY)。
endlocal
