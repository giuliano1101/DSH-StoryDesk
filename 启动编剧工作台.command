#!/bin/zsh
cd "${0:A:h}"
screenwriter_node="${SCREENWRITER_NODE:-$(command -v node)}"
if [[ ! -x "$screenwriter_node" ]]; then
  screenwriter_node="$(command -v node)"
fi
if [[ -z "$screenwriter_node" || ! -x "$screenwriter_node" ]]; then
  print '需要先安装 Node.js 20 或更高版本。'
  read '?按回车关闭'
  exit 1
fi
screenwriter_url="http://127.0.0.1:${SCREENWRITER_PORT:-4378}"
if /usr/bin/curl --silent --fail "$screenwriter_url/api/state" >/dev/null; then
  /usr/bin/open "$screenwriter_url"
  exit 0
fi
"$screenwriter_node" server/index.mjs &
screenwriter_pid=$!
trap 'kill "$screenwriter_pid" 2>/dev/null' EXIT INT TERM
for screenwriter_attempt in {1..30}; do
  if /usr/bin/curl --silent --fail "$screenwriter_url/api/state" >/dev/null; then
    /usr/bin/open "$screenwriter_url"
    print '编剧工作台已打开。关闭此窗口会停止服务，作品仍保存在本机。'
    wait "$screenwriter_pid"
    exit $?
  fi
  sleep 0.2
done
print '工作台未能启动，请检查端口是否被占用。'
wait "$screenwriter_pid"
