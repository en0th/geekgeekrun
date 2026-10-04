// 如果是通过 Electron 运行，禁用 GUI 和 Dock 图标
if (typeof require !== 'undefined') {
  try {
    const { app } = require('electron');
    if (app) {
      // 隐藏 Dock 图标（macOS）
      if (process.platform === 'darwin') {
        app.dock?.hide();
      }
      
      // 防止显示窗口
      app.on('ready', () => {
        // 不创建任何窗口，保持后台运行
      });
      
      // 防止在没有窗口时退出
      app.on('window-all-closed', (e) => {
        e.preventDefault();
        // 不退出应用，保持后台运行
      });
    }
  } catch (e) {
    // 不在 Electron 环境中，忽略
  }
}

const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
const split2 = require('split2');
const fs = require('fs')
const { tmpdir } = require('os')
const { randomUUID } = require('crypto')

const ipcWritePipe = fs.createWriteStream(null, { fd: 3 })
let ipcSocketName = process.env.GEEKGEEKRUND_PIPE_NAME
if (!ipcSocketName) {
  process.env.GEEKGEEKRUND_PIPE_NAME = `geekgeekrun-d_${randomUUID()}`
  ipcSocketName = process.env.GEEKGEEKRUND_PIPE_NAME
}
const ipcSocketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\${ipcSocketName}`
    : path.join(tmpdir(), `${ipcSocketName}.sock`)

const workers = new Map(); // workerId -> { process, status, restartCount, socket, latestScreenshot, latestScreenshotAt }
const userProcessClients = new Set(); // GUI客户端连接集合
const stoppedWorkers = new Set(); // 被用户主动停止的workerId集合，用于防止竞态条件
const pidToProcessInfoMap = new Map()
const socketToWorkerIdSetMap = new WeakMap()
const clientSockets = new Set()
let idleShutdownTimer

// ---- serial BOSS task queue ----
// Tasks that drive a browser on the BOSS account run one at a time, so the account never has
// several automated sessions at once. Long-running tasks (auto-greeting / collect, follow-up)
// make way at their checkpoints and are resumed later by starting them again.
const QUEUED_WORKER_IDS = new Set([
  'geekAutoStartWithBossMain',
  'readNoReplyAutoReminderMain',
  'jobStatusPollMain'
])
// finite tasks run as soon as the current task reaches a checkpoint
const PRIORITY_WORKER_IDS = new Set(['jobStatusPollMain'])
// exit code of a task that made way for a queued one; keep in sync with TASK_YIELD_EXIT_CODE
// in packages/ui/src/common/enums/auto-start-chat.ts
const TASK_YIELD_EXIT_CODE = 90
// a long-running task gets this much time before making way for another queued task
const TIME_SLICE_MS = Number(process.env.GEEKGEEKRUND_TIME_SLICE_MS) || 20 * 60 * 1000
const taskQueue = [] // { workerId, command, args, env, queuedAt, reason: 'waiting' | 'yielded' | 'restarting' }
const taskHistory = [] // most recent first: { workerId, startedAt, endedAt, outcome, code }
// a crashed queued task keeps its turn while it waits to be restarted
let queueSlotHeldUntilRestart = null

function activeQueuedWorker() {
  for (const [workerId, info] of workers.entries()) {
    if (QUEUED_WORKER_IDS.has(workerId)) return info
  }
  return null
}

function queueBusy() {
  return Boolean(activeQueuedWorker() || queueSlotHeldUntilRestart)
}

function enqueueTask(entry, { front = false } = {}) {
  const existing = taskQueue.findIndex((it) => it.workerId === entry.workerId)
  if (existing >= 0) taskQueue.splice(existing, 1)
  const item = { ...entry, queuedAt: entry.queuedAt || Date.now() }
  if (front) taskQueue.unshift(item)
  else if (PRIORITY_WORKER_IDS.has(item.workerId)) {
    // ahead of long-running tasks, behind other priority tasks
    const firstLong = taskQueue.findIndex((it) => !PRIORITY_WORKER_IDS.has(it.workerId))
    taskQueue.splice(firstLong < 0 ? taskQueue.length : firstLong, 0, item)
  } else taskQueue.push(item)
  broadcastStatus()
}

function removeQueuedTask(workerId) {
  const index = taskQueue.findIndex((it) => it.workerId === workerId)
  if (index < 0) return false
  taskQueue.splice(index, 1)
  broadcastStatus()
  return true
}

function startNextQueuedTask() {
  if (queueBusy()) return
  const next = taskQueue.shift()
  if (!next) {
    scheduleIdleShutdown()
    return
  }
  stoppedWorkers.delete(next.workerId)
  startWorker(next, next.restartCount || 0)
}

function shouldYield(workerId) {
  const info = workers.get(workerId)
  if (!info || !QUEUED_WORKER_IDS.has(workerId) || PRIORITY_WORKER_IDS.has(workerId)) return false
  if (!taskQueue.length) return false
  if (PRIORITY_WORKER_IDS.has(taskQueue[0].workerId)) return true
  return Date.now() - (info.sliceStartTime || info.startTime) >= TIME_SLICE_MS
}

// finished task runs, kept across daemon restarts when the UI names a file for them
const TASK_HISTORY_FILE = process.env.GEEKGEEKRUND_TASK_HISTORY_FILE || ''
const TASK_HISTORY_LIMIT = 200

function loadTaskHistory() {
  if (!TASK_HISTORY_FILE) return
  try {
    const saved = JSON.parse(fs.readFileSync(TASK_HISTORY_FILE, 'utf8'))
    if (Array.isArray(saved)) taskHistory.push(...saved.slice(0, TASK_HISTORY_LIMIT))
  } catch {
    // no history yet, or an unreadable file: start empty
  }
}

function saveTaskHistory() {
  if (!TASK_HISTORY_FILE) return
  try {
    fs.writeFileSync(TASK_HISTORY_FILE + '.tmp', JSON.stringify(taskHistory))
    fs.renameSync(TASK_HISTORY_FILE + '.tmp', TASK_HISTORY_FILE)
  } catch (e) {
    console.error('保存任务历史失败:', e)
  }
}

// --name=value arguments the UI passes to a task (run record id, run mode)
function argValue(args, name) {
  const prefix = `--${name}=`
  const found = (args || []).find((it) => typeof it === 'string' && it.startsWith(prefix))
  return found ? found.slice(prefix.length) : undefined
}

function recordTaskHistory(info, outcome, code) {
  const runRecordId = Number(argValue(info.args, 'run-record-id')) || null
  taskHistory.unshift({
    id: `${info.workerId}-${info.startTime}`,
    workerId: info.workerId,
    startedAt: info.startTime,
    endedAt: Date.now(),
    outcome,
    code,
    runRecordId,
    runMode: argValue(info.args, 'run-mode') || null
  })
  taskHistory.length = Math.min(taskHistory.length, TASK_HISTORY_LIMIT)
  saveTaskHistory()
}
loadTaskHistory()

// No tray is exposed: after the last client and task have gone, do not leave
// an invisible daemon running. A new connection cancels this grace period.
function scheduleIdleShutdown() {
  clearTimeout(idleShutdownTimer)
  if (clientSockets.size || workers.size || taskQueue.length || queueSlotHeldUntilRestart) return
  idleShutdownTimer = setTimeout(() => {
    if (clientSockets.size || workers.size || taskQueue.length || queueSlotHeldUntilRestart) return
    server.close(() => process.exit(0))
    ipcWritePipe.end()
  }, 1500)
  idleShutdownTimer.unref()
}

// 创建TCP服务器
const server = net.createServer((socket) => {
  clearTimeout(idleShutdownTimer)
  clientSockets.add(socket)
  console.log('客户端已连接');

  // 使用 split2 按行分割流式数据，处理 JSONL 格式（每行一个 JSON）
  // split2 会自动处理 TCP 分包问题，确保每条完整的消息（以换行符结尾）才会触发
  const splitStream = split2();
  
  socket.pipe(splitStream).on('data', (line) => {
    const trimmedLine = line.toString().trim();
    if (!trimmedLine) {
      return; // 跳过空行
    }
    
    let _callbackUuid
    try {
      const message = JSON.parse(trimmedLine);
      _callbackUuid = message._callbackUuid
      handleMessage(socket, message);
    } catch (parseError) {
      console.error('解析JSON消息失败:', parseError.message);
      console.error('原始数据:', trimmedLine.substring(0, 100)); // 只打印前100个字符
      sendResponse(socket, _callbackUuid, { error: '无效的JSON格式', details: parseError.message });
    }
  });

  splitStream.on('error', (err) => {
    console.error('split2 流处理错误:', err);
    sendResponse(socket, null, { error: '流处理失败' });
  });

  socket.on('error', (err) => {
    console.error('Socket错误:', err);
  });

  socket.on('close', () => {
    clientSockets.delete(socket)
    console.log('客户端已断开连接');
    // 清理GUI客户端连接
    userProcessClients.delete(socket);
    // 清理工具进程连接
    for (const [workerId, workerInfo] of workers.entries()) {
      if (workerInfo.socket === socket) {
        console.log(`工具进程 ${workerId} 的连接已断开`);
        workerInfo.socket = null;
      }
    }
    const workerIdSet = socketToWorkerIdSetMap.get(socket) || new Set()
    ;[...workerIdSet].forEach(workerId => {
      stopWorker(workerId);
    })
    scheduleIdleShutdown()
  });
});

// 处理消息
function handleMessage(socket, message) {
  message.type !== 'get-status' && console.log('收到消息:', message);
  const _callbackUuid = message._callbackUuid
  if (message.type === 'ping') {
    sendResponse(socket, _callbackUuid, {
      success: true, 
      message: 'pong'
    });
    return
  }
  if (message.type === 'user-process-register') {
    // GUI客户端的控制消息
    // 标记为GUI客户端
    if (!userProcessClients.has(socket)) {
      userProcessClients.add(socket);
    }
    sendResponse(socket, _callbackUuid, {
      success: true, 
    });
    return;
  }

  const workerId = message.workerId;
  const workerInfo = workers.get(workerId);
  switch (message.type) {
    // 从工具进程发送的消息（数据、心跳、截图等）
    case 'check-should-exit': {
      const workerId = message.workerId;
      const shouldExit = stoppedWorkers.has(workerId) || !workers.has(workerId);
      
      sendResponse(socket, _callbackUuid, {
        workerId: workerId,
        shouldExit: shouldExit
      });
      
      if (shouldExit) {
        console.log(`工具进程 ${workerId} 查询是否应该退出，返回: 是`);
      }
      return
    }
    case 'check-should-yield': {
      const yieldNow = shouldYield(message.workerId)
      sendResponse(socket, _callbackUuid, { workerId: message.workerId, shouldYield: yieldNow })
      if (yieldNow) {
        const info = workers.get(message.workerId)
        if (info) info.yielding = true
        console.log(`工具进程 ${message.workerId} 让出给排队中的任务`)
      }
      return
    }
    case 'worker-to-gui-message': {
      if (workerInfo && message.data?.type === 'task-progress') {
        workerInfo.runtimeStorage = workerInfo.runtimeStorage || {}
        workerInfo.runtimeStorage.taskProgress = message.data
      }
      // 将 prerequisite step 状态写入 worker 的 runtimeStorage
      if (
        workerInfo &&
        message.data?.type === 'prerequisite-step-by-step-check' &&
        message.data?.step?.id
      ) {
        workerInfo.runtimeStorage = workerInfo.runtimeStorage || {}
        workerInfo.runtimeStorage.stepStatusMapByStepId =
          workerInfo.runtimeStorage.stepStatusMapByStepId || {}
        workerInfo.runtimeStorage.stepStatusMapByStepId[
          message.data.step.id
        ] = {
          step: message.data.step,
          runRecordId: message.data.runRecordId
        }
      }

      // 转发工具进程消息到GUI客户端
      broadcastToGUI({
        type: 'worker-to-gui-message',
        workerId: workerId,
        data: message.data || message,
        timestamp: Date.now()
      });
      return
    }
    case 'worker-screenshot': {
      if (workerInfo && message.data && message.data.screenshot /* && workerInfo.socket === socket */) {
        // 如果携带截图信息，则在守护进程内缓存一份，供 get-status 使用
        try {
          workerInfo.latestScreenshot = message.data.screenshot;
          workerInfo.latestScreenshotAt = Date.now();
        } catch (e) {
          console.error('缓存 worker 截图信息失败:', e);
        }
      }
      return
    }

    // 从GUI进程发送的消息（数据、心跳、截图等）
    case 'start-worker': {
      const {
        workerId,
        command,
        args,
        env
      } = message
      if (workers.has(workerId)) {
        console.log(`工具进程 ${workerId} 已在运行`);
        return;
      }
      if (QUEUED_WORKER_IDS.has(workerId) && (queueBusy() || taskQueue.length)) {
        enqueueTask({ workerId, command, args, env, reason: 'waiting' })
        sendResponse(socket, _callbackUuid, {
          success: true,
          queued: true,
          position: taskQueue.findIndex((it) => it.workerId === workerId) + 1,
          message: `工具进程 ${workerId} 已进入队列`,
          workerId
        });
      } else {
        // a stop requested while it wasn't running must not cling to the new run
        stoppedWorkers.delete(workerId)
        startWorker({
          workerId,
          command,
          args,
          env
        });
        sendResponse(socket, _callbackUuid, {
          success: true, 
          message: `工具进程 ${message.workerId} 已启动`,
          workerId: message.workerId 
        });
      }
      let socketToWorkerIdSet = socketToWorkerIdSetMap.get(socket)
      if (
        !(socketToWorkerIdSet instanceof Set)
      ) {
        socketToWorkerIdSet = new Set()
        socketToWorkerIdSetMap.set(
          socket,
          socketToWorkerIdSet
        )
      }
      socketToWorkerIdSet.add(workerId)
      return
    }

    case 'stop-worker': {
      stopWorker(message.workerId);
      sendResponse(socket, _callbackUuid, { 
        success: true, 
        message: `工具进程 ${message.workerId} 已停止`,
        workerId: message.workerId 
      });
      return
    }

    case 'get-status': {
      const status = getWorkersStatus();
      sendResponse(socket, _callbackUuid, {
        success: true, 
        workers: status,
        ...getQueueStatus()
      });
      return
    }

    default: {
      sendResponse(socket, _callbackUuid, { error: '未知的消息类型' });
    }
  }
}

// 启动工具进程
function startWorker({ workerId, command, args, env }, restartCount = 0) {
  const noAutoRestartExitCodeSet = new Set([0]);
  (env.GEEKGEEKRUND_NO_AUTO_RESTART_EXIT_CODE ?? '')
    .split(',')
    .map(n => parseInt(n))
    .forEach(n => noAutoRestartExitCodeSet.add(n))

  console.log(`启动工具进程: ${workerId}${restartCount > 0 ? ` (重启第${restartCount}次)` : ''}`);
  // 添加参数使工具进程在后台运行，不显示 UI
  const workerProcess = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...env,
      GEEKGEEKRUND_WORKER_ID: workerId,
      GEEKGEEKRUND_RESTART_COUNT: restartCount.toString(),
    }
  });

  let output = '';
  workerProcess.stdout.on('data', (data) => {
    output += data.toString();
    // the task writes its own log file entries; the relay only matters at debug level
    console.debug(`工具进程 ${workerId} 输出:`, data.toString().trim());
  });

  workerProcess.stderr.on('data', (data) => {
    console.error(`工具进程 ${workerId} 错误:`, data.toString().trim());
  });

  workerProcess.on('exit', (code, signal) => {
    console.log(`工具进程 ${workerId} 退出，代码: ${code}, 信号: ${signal}`);
    const workerInfo = pidToProcessInfoMap.get(workerProcess.pid)
    if (workerInfo) {
      pidToProcessInfoMap.delete(workerProcess.pid)
      // 关闭工具进程的TCP连接
      if (workerInfo.socket) {
        workerInfo.socket.destroy();
      }
      
      // made way for a queued task: requeue it behind the others, no restart and no exit event
      if (code === TASK_YIELD_EXIT_CODE && !stoppedWorkers.has(workerId)) {
        workers.delete(workerId);
        recordTaskHistory(workerInfo, 'yielded', code)
        enqueueTask({ workerId, command, args, env, reason: 'yielded' })
        broadcastToGUI({ type: 'worker-yielded', workerId })
        startNextQueuedTask()
        return
      }

      const shouldRestart = !noAutoRestartExitCodeSet.has(code) // && code !== null;
      // 使用当前的 restartCount 加1，而不是从 workerInfo 中取（因为可能已经被删除）
      const restartCount = (workerInfo.restartCount || 0) + 1;
      
      workers.delete(workerId);
      const willRestart = shouldRestart && !stoppedWorkers.has(workerId)
      if (QUEUED_WORKER_IDS.has(workerId)) {
        recordTaskHistory(
          workerInfo,
          stoppedWorkers.has(workerId) ? 'stopped' : willRestart ? 'restarting' : code === 0 ? 'finished' : 'failed',
          code
        )
        // the crashed task keeps its turn until it has been restarted
        if (willRestart) queueSlotHeldUntilRestart = workerId
      }
      
      // 通知GUI客户端工具进程已退出
      broadcastToGUI({
        type: 'worker-exited',
        workerId: workerId,
        code: code,
        signal: signal,
        restarting: shouldRestart && !stoppedWorkers.has(workerId),
        restartCount: restartCount
      });
      
      // 如果进程意外退出（非正常停止），且不在停止列表中，自动重启
      if (shouldRestart && !stoppedWorkers.has(workerId)) {
        console.log(`工具进程 ${workerId} 意外退出，准备重启 (第${restartCount}次)`);
        
        // 延迟重启，避免频繁重启
        setTimeout(() => {
          if (queueSlotHeldUntilRestart === workerId) queueSlotHeldUntilRestart = null
          // 再次检查：确保worker不在停止列表中，且当前没有运行
          if (!workers.has(workerId) && !stoppedWorkers.has(workerId)) {
            startWorker({ workerId, command, args, env }, restartCount);
          } else if (stoppedWorkers.has(workerId)) {
            console.log(`工具进程 ${workerId} 在重启前被标记为停止，取消重启`);
            // 从停止列表中移除，因为已经处理完毕
            stoppedWorkers.delete(workerId);
            broadcastToGUI({
              type: 'worker-exited',
              workerId: workerId,
              code: code,
              signal: signal,
              restarting: false,
              restartCount: restartCount
            });
            if (QUEUED_WORKER_IDS.has(workerId)) startNextQueuedTask()
          }
        }, 2000);
      } else if (stoppedWorkers.has(workerId)) {
        // 如果是在停止列表中，清理标记
        console.log(`工具进程 ${workerId} 已停止，清理停止标记`);
        stoppedWorkers.delete(workerId);
      }
      if (!willRestart && QUEUED_WORKER_IDS.has(workerId)) startNextQueuedTask()
    } else {
      // 如果workerInfo不存在，可能是已经被stopWorker删除
      // 检查停止列表，如果在则清理
      if (stoppedWorkers.has(workerId)) {
        stoppedWorkers.delete(workerId);
      }
    }
  });

  workerProcess.on('error', (err) => {
    console.log(err)
  })

  const workerInfo = {
    process: workerProcess,
    status: 'running',
    startTime: Date.now(),
    restartCount, // 使用传入的重启次数
    runtimeStorage: {
      stepStatusMapByStepId: {}
    },
    // socket: null, // 工具进程的TCP连接，稍后由工具进程注册
    // lastHeartbeat: null,
    command,
    args,
    env,
    workerId,
  }
  workers.set(workerId, workerInfo);
  pidToProcessInfoMap.set(workerProcess.pid, workerInfo);
  // 定期发送状态更新
  broadcastStatus();
}

// 停止工具进程
function stopWorker(workerId) {
  const workerInfo = workers.get(workerId);
  // a task that is only waiting in the queue just leaves it
  removeQueuedTask(workerId)
  
  // 无论workerInfo是否存在，都添加到停止列表，防止竞态条件
  stoppedWorkers.add(workerId);
  console.log(`停止工具进程: ${workerId} (已添加到停止列表)`);
  if (!workerInfo) {
    console.log(`工具进程 ${workerId} 不存在，但已标记为停止（防止重启）`);
    // 通知GUI客户端
    broadcastToGUI({
      type: 'worker-disconnected',
      workerId: workerId,
      message: `工具进程 ${workerId} 已停止`
    });
    // 延迟发送状态更新
    setTimeout(() => broadcastStatus(), 500);
    return;
  }
  
  // 关闭工具进程的TCP连接
  if (workerInfo.socket) {
    workerInfo.socket.destroy();
  }
  
  workerInfo.process.kill('SIGTERM');
  workers.delete(workerId);
  
  // 通知GUI客户端
  broadcastToGUI({
    type: 'worker-disconnected',
    workerId: workerId,
    message: `工具进程 ${workerId} 已断开`
  });
  
  // 延迟发送状态更新
  setTimeout(() => broadcastStatus(), 500);
}

// 获取所有工具进程状态
function getWorkersStatus() {
  const status = [];
  for (const [workerId, workerInfo] of workers.entries()) {
    status.push({
      workerId,
      status: workerInfo.status,
      uptime: Date.now() - workerInfo.startTime,
      restartCount: workerInfo.restartCount || 0,
      runtimeStorage: workerInfo.runtimeStorage || {},
      // connected: workerInfo.socket !== null && !workerInfo.socket.destroyed,
      // lastHeartbeat: workerInfo.lastHeartbeat,
      command: workerInfo.command,
      args: workerInfo.args,
      pid: workerInfo.process?.pid,
      // 最新截图（通常是 data URL 或 base64 字符串），以及截图时间
      screenshot: workerInfo.latestScreenshot ?? null,
      screenshotAt: workerInfo.latestScreenshotAt ?? null,
      // about to make way for a queued task
      yielding: Boolean(workerInfo.yielding),
    });
  }
  return status;
}

function getQueueStatus() {
  return {
    queue: taskQueue.map((it, index) => ({
      workerId: it.workerId,
      position: index + 1,
      queuedAt: it.queuedAt,
      reason: it.reason,
      args: it.args
    })),
    history: taskHistory
  }
}

// 广播状态更新给所有GUI客户端
function broadcastStatus() {
  const status = getWorkersStatus();
  broadcastToGUI({
    type: 'status',
    workers: status,
    ...getQueueStatus()
  });
}

// 广播消息给所有GUI客户端
function broadcastToGUI(message) {
  userProcessClients.forEach(socket => {
    if (!socket.destroyed) {
      try {
        sendResponse(socket, null, message);
      } catch (e) {
        console.error('广播消息失败:', e);
        userProcessClients.delete(socket);
      }
    }
  });
}

// 发送响应
function sendResponse(socket, _callbackUuid, response) {
  try {
    socket.write(JSON.stringify({
      ...response,
      _callbackUuid
    }) + '\n');
  } catch (e) {
    console.error('发送响应失败:', e);
  }
}

// 启动服务器
new Promise((resolve, reject) => {
  server.once('error', (err) => {
    ipcWritePipe.write(
      JSON.stringify({ type: 'DAEMON_FATAL', error: err }),
      (err) => void err
    )
    reject(err)
  })
  server.listen(ipcSocketPath, (err) => {
    console.log(`守护进程服务器运行在端口 ${ipcSocketPath}`);
    ipcWritePipe.write(
      JSON.stringify({ type: 'DAEMON_READY' }),
      (err) => void err
    )
    if (!err) {
      resolve(true)
    }
    else {
      reject(err)
    }
  });
})

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在关闭所有工具进程...');
  for (const [workerId, workerInfo] of workers.entries()) {
    workerInfo.process.kill('SIGTERM');
  }
  server.close(() => {
    console.log('守护进程已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('收到SIGINT信号，正在关闭所有工具进程...');
  for (const [workerId, workerInfo] of workers.entries()) {
    workerInfo.process.kill('SIGTERM');
  }
  server.close(() => {
    console.log('守护进程已关闭');
    process.exit(0);
  });
});
