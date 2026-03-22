const { app, ipcMain, BrowserWindow, screen, shell, crashReporter  } = require("electron");
const remote = require("@electron/remote/main");
const fs = require("graceful-fs");
const path = require("path");
const os = require("os");
const url = require("url");
const http = require("http");
const { loadPresets, savePreset, deletePreset } = require("./presets");
const NotificationService = require('./notification-service');
const { apiToBackgroundPayload, placementToApiResponse } = require("./server-adapter");
const { runServerGeneticNesting, mergeCandidateRawsForResponse } = require("./server-ga");
require("events").EventEmitter.defaultMaxListeners = 30;

const isServerMode = process.argv.includes("--server") || process.env.NESTNOW_SERVER === "1";

app.on('render-process-gone', (event, webContents, details) => { console.error('Render process gone:', event, webContents, details); });

remote.initialize();

app.commandLine.appendSwitch("--enable-precise-memory-info");
crashReporter.start({ uploadToServer : false });
const lastCrash = crashReporter.getLastCrashReport();
if (lastCrash) console.log(lastCrash);

/*
// main menu for mac
const template = [
{
    label: 'Deepnest',
    submenu: [
      {
        role: 'about'
      },
      {
        type: 'separator'
      },
      {
        role: 'services',
        submenu: []
      },
      {
        type: 'separator'
      },
      {
        role: 'hide'
      },
      {
        role: 'hideothers'
      },
      {
        role: 'unhide'
      },
      {
        type: 'separator'
      },
      {
        role: 'quit'
      }
    ]
  }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);
*/

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow = null;
let notificationWindow = null;
var backgroundWindows = [];
const notificationService = new NotificationService();

// single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Create myWindow, load the rest of the app, etc...
  app.whenReady().then(() => {
    //myWindow = createWindow()
  });
}

function createMainWindow() {
  // Create the browser window.
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  var frameless = process.platform == "darwin";
  //var frameless = true;

  mainWindow = new BrowserWindow({
    width: Math.ceil(width * 0.9),
    height: Math.ceil(height * 0.9),
    frame: !frameless,
    show: false,
    webPreferences: {
      contextIsolation: false,
      enableRemoteModule: true,
      nodeIntegration: true,
      nativeWindowOpen: true,
    },
  });

  remote.enable(mainWindow.webContents);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' }
  })

  // and load the index.html of the app.
  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "./main/index.html"),
      protocol: "file:",
      slashes: true,
    })
  );

  mainWindow.setMenu(null);

  // Open the DevTools.
  if (process.env["deepnest_debug"] === "1")
    mainWindow.webContents.openDevTools();

  // Emitted when the window is closed.
  mainWindow.on("closed", function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });

  if (process.env.SAVE_PLACEMENTS_PATH !== undefined) {
    global.NEST_DIRECTORY = process.env.SAVE_PLACEMENTS_PATH;
  } else {
    global.NEST_DIRECTORY = path.join(os.tmpdir(), "nest");
  }
  // make sure the export directory exists
  if (!fs.existsSync(global.NEST_DIRECTORY))
    fs.mkdirSync(global.NEST_DIRECTORY);
}

function createNotificationWindow(notification) {
  if (notificationWindow) {
    notificationWindow.close();
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  notificationWindow = new BrowserWindow({
    width: 750,
    height: 500,
    parent: mainWindow,
    alwaysOnTop: true,
    type: "notification",
    center: true,
    maximizable: false,
    minimizable: false,
    resizable: false,
    modal: true,
    show: false,
    webPreferences: {
      contextIsolation: false,
      enableRemoteModule: true,
      nodeIntegration: true
    }
  });

  remote.enable(notificationWindow.webContents);
  notificationWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' }
  })

  notificationWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "./main/notification.html"),
      protocol: "file:",
      slashes: true
    })
  );

  notificationWindow.setMenu(null);
  // Open the DevTools.
  if (process.env["deepnest_debug"] === "1")
    notificationWindow.webContents.openDevTools();

  notificationWindow.once("ready-to-show", () => {
    notificationWindow.show();
  });

  notificationWindow.on("closed", () => {
    notificationWindow = null;
  });

  // Store the notification data for access by the renderer
  notificationWindow.notificationData = notification;
}

async function runNotificationCheck() {
  const notification = await notificationService.checkForNotifications();
  if (notification) {
    createNotificationWindow(notification);
  }
}


let winCount = 0;

function createBackgroundWindows(onFirstReady) {
  //busyWindows = [];
  // used to have 8, now just 1 background window
  if (winCount < 1) {
    var back = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: false,
        enableRemoteModule: true,
        nodeIntegration: true,
        nativeWindowOpen: true,
      },
    });

    remote.enable(back.webContents);

    if (process.env["deepnest_debug"] === "1") back.webContents.openDevTools();

    back.loadURL(
      url.format({
        pathname: path.join(__dirname, "./main/background.html"),
        protocol: "file:",
        slashes: true,
      })
    );

    backgroundWindows[winCount] = back;

    back.once("ready-to-show", () => {
      //back.show();
      winCount++;
      if (typeof onFirstReady === "function") {
        onFirstReady();
      }
      createBackgroundWindows(onFirstReady);
    });
    back.webContents.on('render-process-gone', (event, details) => { console.error('Render process gone:', event, details); });
    back.on('render-process-gone', (event) => { console.error('Render process gone:', event); });
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  if (isServerMode) {
    if (process.env.SAVE_PLACEMENTS_PATH !== undefined) {
      global.NEST_DIRECTORY = process.env.SAVE_PLACEMENTS_PATH;
    } else {
      global.NEST_DIRECTORY = path.join(os.tmpdir(), "nest");
    }
    if (!fs.existsSync(global.NEST_DIRECTORY)) {
      fs.mkdirSync(global.NEST_DIRECTORY);
    }
    ipcMain.once("server-background-ready", () => {
      if (!serverStarted) {
        serverStarted = true;
        onServerBackgroundReady();
      }
    });
    createBackgroundWindows(() => {});
  } else {
    createMainWindow();
    mainWindow.once("ready-to-show", () => {
      mainWindow.show();
      createBackgroundWindows();

      // Check for notifications after a short delay to ensure the app is fully loaded
      setTimeout(async () => {
        runNotificationCheck();
      }, 3000); // 3 seconds

      setInterval(async () => {
        runNotificationCheck();
      }, 30*60*1000); // every 30 minutes
    });
    mainWindow.on("closed", () => {
      app.quit();
    });
  }
});

// Quit when all windows are closed (GUI mode only). Server mode uses hidden
// workers that are destroyed/recreated on stop; must not quit the HTTP server.
app.on("window-all-closed", function () {
  if (isServerMode) return;
  app.quit();
});

app.on("activate", function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createMainWindow();
  }
});

app.on("before-quit", function () {
  var p = path.join(__dirname, "./nfpcache");
  if (fs.existsSync(p)) {
    fs.readdirSync(p).forEach(function (file, index) {
      var curPath = p + "/" + file;
      fs.unlinkSync(curPath);
    });
  }
});

//ipcMain.on('background-response', (event, payload) => mainWindow.webContents.send('background-response', payload));
//ipcMain.on('background-start', (event, payload) => backgroundWindows[0].webContents.send('background-start', payload));

// Server mode: pending resolve for the in-flight nest request (one at a time)
let pendingNestResolve = null;
let serverStarted = false;
let pendingNestWorker = null;
let pendingNestTimeout = null;

/** Last-known progress for GET /progress (server mode). */
var nestHttpProgress = {
  busy: false,
  placement: null,
  ga: null,
  /** Genetic search: latest improved layout (same shape as POST /nest 200 body fields). */
  bestSoFar: null,
  updatedAt: 0,
};

function resetNestHttpProgressForNewJob() {
  nestHttpProgress.busy = true;
  nestHttpProgress.placement = null;
  nestHttpProgress.ga = null;
  nestHttpProgress.bestSoFar = null;
  nestHttpProgress.updatedAt = Date.now();
}

function finishNestHttpProgress() {
  nestHttpProgress.busy = false;
  nestHttpProgress.bestSoFar = null;
  nestHttpProgress.updatedAt = Date.now();
}

function setNestHttpCorsHeaders(req, res) {
  var origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function parseRequestTimeoutMs() {
  const raw = process.env.NESTNOW_REQUEST_TIMEOUT_MS;
  const ms = raw != null ? parseInt(String(raw), 10) : NaN;
  // Default 10 minutes — aligned with Keystone default “Max time per layout try” when body omits requestTimeoutMs
  if (!Number.isFinite(ms) || ms <= 0) return 600000;
  return Math.max(1000, ms);
}

/** IT diagnostics: classify NestNow 500 responses (see Keystone “Details for IT”). */
function nestFailureKindFromMessage(msg) {
  var m = String(msg || "").toLowerCase();
  if (m.includes("timed out") || m.includes("timeout")) return "timeout";
  if (m.includes("stopped")) return "stopped";
  if (m.includes("placement failed")) return "placement_failed";
  return "no_layout";
}

function clearInFlightLock() {
  pendingNestResolve = null;
  if (pendingNestTimeout) {
    clearTimeout(pendingNestTimeout);
    pendingNestTimeout = null;
  }
  if (pendingNestWorker) {
    try {
      pendingNestWorker.isBusy = false;
    } catch (e) {}
    pendingNestWorker = null;
  }
}

function cancelInFlight(reason) {
  if (!pendingNestResolve) return false;
  const resolve = pendingNestResolve;
  // Clear lock first so future requests can proceed even if resolve triggers errors
  clearInFlightLock();
  try {
    resolve({ error: reason || "Stopped", fitness: null });
  } catch (e) {}
  // Reset workers to a clean state (mirrors background-stop behavior)
  try {
    for (var i = 0; i < backgroundWindows.length; i++) {
      if (backgroundWindows[i]) {
        backgroundWindows[i].destroy();
        backgroundWindows[i] = null;
      }
    }
    winCount = 0;
    createBackgroundWindows(() => {});
  } catch (e) {}
  return true;
}

function onServerBackgroundReady() {
  const port = parseInt(process.env.NESTNOW_PORT, 10) || 3001;
  const server = http.createServer(async (req, res) => {
    const pathname = (req.url || "").split("?")[0];

    const setJson = (status, body) => {
      setNestHttpCorsHeaders(req, res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };

    if (req.method === "OPTIONS") {
      setNestHttpCorsHeaders(req, res);
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/progress") {
      setJson(200, {
        busy: nestHttpProgress.busy,
        placement: nestHttpProgress.placement,
        ga: nestHttpProgress.ga,
        bestSoFar: nestHttpProgress.bestSoFar,
        updatedAt: nestHttpProgress.updatedAt,
      });
      return;
    }

    if (req.method !== "POST" || (pathname !== "/nest" && pathname !== "/stop")) {
      setJson(404, {
        error: "Not found. Use GET /progress, POST /nest, or POST /stop",
      });
      return;
    }

    if (pathname === "/stop") {
      const stopped = cancelInFlight("Stopped by client");
      setJson(200, { ok: true, stopped });
      return;
    }

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      handleNestRequest(body, setJson);
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(
      "NestNow server mode: http://127.0.0.1:" +
        port +
        " (GET /progress, POST /nest, POST /stop)",
    );
  });
}

function runSingleNestRequest(worker, payload, timeoutOverrideMs) {
  return new Promise((resolve, reject) => {
    if (pendingNestResolve) {
      reject(new Error("Nest pipeline busy"));
      return;
    }
    if (pendingNestTimeout) {
      clearTimeout(pendingNestTimeout);
      pendingNestTimeout = null;
    }
    const timeoutMs =
      timeoutOverrideMs != null &&
      Number.isFinite(timeoutOverrideMs) &&
      timeoutOverrideMs >= 1000
        ? Math.min(3600000, timeoutOverrideMs)
        : parseRequestTimeoutMs();
    pendingNestTimeout = setTimeout(() => {
      if (pendingNestResolve) {
        console.error("Nest request timed out after " + timeoutMs + " ms");
        cancelInFlight("Nesting timed out");
      }
    }, timeoutMs);

    worker.isBusy = true;
    pendingNestWorker = worker;
    pendingNestResolve = (result) => {
      clearInFlightLock();
      resolve(result);
    };

    worker.webContents.send("server-nest-request", {
      ...payload,
      _responseChannel: "server-nest-response",
      _serverMode: true,
    });
  });
}

function handleNestRequest(body, setJson) {
  let parsed;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch (e) {
    setJson(400, { error: "Invalid JSON" });
    return;
  }

  let requestTimeoutOverrideMs = null;
  if (parsed && typeof parsed === "object" && "requestTimeoutMs" in parsed) {
    const rawT = parsed.requestTimeoutMs;
    const t =
      typeof rawT === "number" ? rawT : parseInt(String(rawT), 10);
    if (Number.isFinite(t) && t >= 1000) {
      requestTimeoutOverrideMs = Math.min(3600000, t);
    }
  }

  const { payload, error: adapterError } = apiToBackgroundPayload(parsed);
  if (adapterError) {
    setJson(400, { error: adapterError });
    return;
  }

  if (pendingNestResolve) {
    setJson(503, { error: "Previous request still in progress" });
    return;
  }

  const worker = backgroundWindows.find((w) => w && !w.isBusy);
  if (!worker) {
    setJson(503, { error: "No background worker available" });
    return;
  }

  resetNestHttpProgressForNewJob();
  var nestJobStartedAt = Date.now();
  runServerGeneticNesting(payload, {
    runSingle: (p) =>
      runSingleNestRequest(worker, p, requestTimeoutOverrideMs),
    onProgress: (s) => {
      nestHttpProgress.ga = {
        gen: s.gen,
        generations: s.generations,
        idx: s.idx,
        pop: s.pop,
        evalCount: s.evalCount,
      };
      if (s.bestSoFar) {
        nestHttpProgress.bestSoFar = s.bestSoFar;
      }
      nestHttpProgress.updatedAt = Date.now();
      if (process.env.NESTNOW_SERVER_PROGRESS === "1") {
        console.log("[nest GA]", s);
      }
    },
  })
    .then(
      ({
        result,
        candidates,
        roundBests,
        lastEvalError,
        evalCount,
        populationSize,
        gaGenerations,
      }) => {
      var nestNowDurationMs = Date.now() - nestJobStartedAt;
      if (result && result.fitness != null) {
        var body = placementToApiResponse(result);
        var mergedRaws = mergeCandidateRawsForResponse(
          result,
          candidates,
          roundBests,
        );
        if (mergedRaws && mergedRaws.length > 0) {
          body.candidates = mergedRaws.map(function (p) {
            return placementToApiResponse(p);
          });
        }
        setJson(200, body);
      } else {
        var errMsg = "";
        if (result && result.error != null) {
          errMsg = String(result.error).trim();
        }
        if (!errMsg && lastEvalError) {
          errMsg = String(lastEvalError).trim();
        }
        var failureKind = nestFailureKindFromMessage(errMsg);
        var defaultNoLayout =
          "No valid layout was produced. Check sheet size, spacing, and part geometry, or try Preview settings.";
        var errBody = {
          error: errMsg || defaultNoLayout,
          failureKind: failureKind,
          nestNowDurationMs: nestNowDurationMs,
        };
        if (typeof evalCount === "number" && Number.isFinite(evalCount)) {
          errBody.evalCount = evalCount;
        }
        if (typeof populationSize === "number" && Number.isFinite(populationSize)) {
          errBody.populationSize = populationSize;
        }
        if (typeof gaGenerations === "number" && Number.isFinite(gaGenerations)) {
          errBody.gaGenerations = gaGenerations;
        }
        if (lastEvalError) {
          errBody.lastEvalError = String(lastEvalError).trim();
        }
        var liveBest = nestHttpProgress.bestSoFar;
        if (liveBest && typeof liveBest === "object") {
          errBody.bestEffort = liveBest;
        }
        setJson(500, errBody);
      }
    })
    .catch((e) => {
      clearInFlightLock();
      var nestNowDurationMs = Date.now() - nestJobStartedAt;
      setJson(500, {
        error: String((e && e.message) || e) || "Nesting failed",
        failureKind: "exception",
        nestNowDurationMs: nestNowDurationMs,
      });
    })
    .finally(() => {
      finishNestHttpProgress();
    });
}

ipcMain.on("server-nest-response", function (event, payload) {
  if (pendingNestResolve) {
    pendingNestResolve(payload);
  }
  for (var i = 0; i < backgroundWindows.length; i++) {
    try {
      if (backgroundWindows[i] && backgroundWindows[i].webContents === event.sender) {
        backgroundWindows[i].isBusy = false;
        break;
      }
    } catch (ex) {}
  }
});

ipcMain.on("background-start", function (event, payload) {
  console.log("starting background!");
  for (var i = 0; i < backgroundWindows.length; i++) {
    if (backgroundWindows[i] && !backgroundWindows[i].isBusy) {
      backgroundWindows[i].isBusy = true;
      backgroundWindows[i].webContents.send("background-start", payload);
      break;
    }
  }
});

ipcMain.on("background-response", function (event, payload) {
  for (var i = 0; i < backgroundWindows.length; i++) {
    // todo: hack to fix errors on app closing - should instead close workers when window is closed
    try {
      if (backgroundWindows[i].webContents == event.sender) {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("background-response", payload);
        }
        backgroundWindows[i].isBusy = false;
        break;
      }
    } catch (ex) {
      // ignore errors, as they can reference destroyed objects during a window close event
    }
  }
});

ipcMain.on("background-progress", function (event, payload) {
  if (isServerMode && payload && typeof payload === "object") {
    nestHttpProgress.placement = {
      index: payload.index,
      progress: payload.progress,
    };
    nestHttpProgress.updatedAt = Date.now();
  }
  // todo: hack to fix errors on app closing - should instead close workers when window is closed
  try {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send("background-progress", payload);
    }
  } catch (ex) {
    // when shutting down while processes are running, this error can occur so ignore it for now.
  }
});

ipcMain.on("background-stop", function (event) {
  for (var i = 0; i < backgroundWindows.length; i++) {
    if (backgroundWindows[i]) {
      backgroundWindows[i].destroy();
      backgroundWindows[i] = null;
    }
  }
  winCount = 0;

  createBackgroundWindows();

  console.log("stopped!", backgroundWindows);
});

// Backward compat with https://electron-settings.js.org/index.html#configure
const configPath = path.resolve(app.getPath("userData"), "settings.json");
ipcMain.handle("read-config", () => {
  return fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath).toString().replaceAll("http://convert.deepnest.io", "https://converter.deepnest.app/convert").replaceAll("https://convert.deepnest.io", "https://converter.deepnest.app/convert"))
    : {};
});
ipcMain.handle("write-config", (event, stringifiedConfig) => {
  fs.writeFileSync(configPath, stringifiedConfig);
});

ipcMain.on("login-success", function (event, payload) {
  mainWindow.webContents.send("login-success", payload);
});

ipcMain.on("purchase-success", function (event) {
  mainWindow.webContents.send("purchase-success");
});

ipcMain.on("setPlacements", (event, payload) => {
  global.exportedPlacements = payload;
});

ipcMain.on("test", (event, payload) => {
  global.test = payload;
});

ipcMain.handle("load-presets", () => {
  return loadPresets();
});

ipcMain.handle("save-preset", (event, name, config) => {
  savePreset(name, config);
});

ipcMain.handle("delete-preset", (event, name) => {
  deletePreset(name);
});

// Handle notification window events
ipcMain.on('get-notification-data', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && win.notificationData) {
    event.reply('notification-data', {
      title: win.notificationData.title,
      content: win.notificationData.content
    });
  }
});

ipcMain.on('close-notification', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && win.notificationData && win.notificationData.markAsSeen) {
    win.notificationData.markAsSeen();
  }
  
  // Close the current notification window
  if (win) {
    win.close();
  }
  
  // Check for additional notifications and show them if they exist
  setTimeout(async () => {
    const nextNotification = await notificationService.checkForNotifications();
    if (nextNotification) {
      createNotificationWindow(nextNotification);
    }
  }, 500); // Small delay to ensure clean transition
});
