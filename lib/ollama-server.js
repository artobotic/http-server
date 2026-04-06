'use strict';

var http = require('http');
var url = require('url');

var OLLAMA_HOST = process.env.OLLAMA_HOST || '127.0.0.1';
var OLLAMA_PORT = parseInt(process.env.OLLAMA_PORT, 10) || 11434;

function OllamaServer(options) {
  options = options || {};
  this.model = options.model || 'gemma4:31b-cloud';
  this.name = options.name || 'claude';
  this.port = options.port || 0;
  this.host = options.host || '127.0.0.1';
  this.logFn = options.logFn || null;

  var self = this;
  this.server = http.createServer(function (req, res) {
    var parsed = url.parse(req.url);

    if (self.logFn) {
      self.logFn(req, res);
    }

    if (parsed.pathname === '/' && req.method === 'GET') {
      self._serveChatUI(req, res);
    } else if (parsed.pathname === '/api/chat' && req.method === 'POST') {
      self._proxyToOllama(req, res);
    } else if (parsed.pathname === '/api/tags' && req.method === 'GET') {
      self._proxyGetToOllama('/api/tags', res);
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
}

OllamaServer.prototype.listen = function (port, host, cb) {
  this.server.listen(port, host, cb);
};

OllamaServer.prototype.close = function () {
  return this.server.close();
};

OllamaServer.prototype._serveChatUI = function (req, res) {
  var model = this.model;
  var name = this.name;
  var html = buildChatUI(name, model);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.statusCode = 200;
  res.end(html);
};

OllamaServer.prototype._proxyToOllama = function (req, res) {
  var body = [];
  req.on('data', function (chunk) { body.push(chunk); });
  req.on('end', function () {
    var bodyStr = Buffer.concat(body).toString();
    var parsed;
    try {
      parsed = JSON.parse(bodyStr);
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    var ollamaBody = JSON.stringify(parsed);
    var ollamaReq = http.request({
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(ollamaBody)
      }
    }, function (ollamaRes) {
      res.setHeader('Content-Type', ollamaRes.headers['content-type'] || 'application/json');
      res.statusCode = ollamaRes.statusCode;
      ollamaRes.pipe(res);
    });

    ollamaReq.on('error', function (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'Ollama unreachable: ' + err.message }));
    });

    ollamaReq.write(ollamaBody);
    ollamaReq.end();
  });
};

OllamaServer.prototype._proxyGetToOllama = function (path, res) {
  var ollamaReq = http.request({
    hostname: OLLAMA_HOST,
    port: OLLAMA_PORT,
    path: path,
    method: 'GET'
  }, function (ollamaRes) {
    res.setHeader('Content-Type', ollamaRes.headers['content-type'] || 'application/json');
    res.statusCode = ollamaRes.statusCode;
    ollamaRes.pipe(res);
  });

  ollamaReq.on('error', function (err) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'Ollama unreachable: ' + err.message }));
  });

  ollamaReq.end();
};

function buildChatUI(name, model) {
  return '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <title>' + esc(name) + ' &mdash; ollama chat</title>\n' +
'  <style>\n' +
'    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n' +
'    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e8e8e8; display: flex; flex-direction: column; height: 100vh; }\n' +
'    header { padding: 12px 20px; background: #1a1a1a; border-bottom: 1px solid #2a2a2a; display: flex; align-items: center; gap: 10px; }\n' +
'    header h1 { font-size: 1rem; font-weight: 600; }\n' +
'    header .model-badge { font-size: 0.75rem; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 4px; padding: 2px 8px; color: #aaa; }\n' +
'    #messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }\n' +
'    .msg { max-width: 75%; padding: 10px 14px; border-radius: 10px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }\n' +
'    .msg.user { align-self: flex-end; background: #1d6ef5; color: #fff; border-bottom-right-radius: 3px; }\n' +
'    .msg.assistant { align-self: flex-start; background: #1e1e1e; border: 1px solid #2c2c2c; border-bottom-left-radius: 3px; }\n' +
'    .msg.error { align-self: flex-start; background: #3a1a1a; border: 1px solid #6a2a2a; color: #f87171; }\n' +
'    #input-row { display: flex; gap: 8px; padding: 14px 20px; background: #1a1a1a; border-top: 1px solid #2a2a2a; }\n' +
'    #input-row textarea { flex: 1; resize: none; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 8px; color: #e8e8e8; font-size: 0.95rem; padding: 10px 12px; outline: none; line-height: 1.4; }\n' +
'    #input-row textarea:focus { border-color: #1d6ef5; }\n' +
'    #input-row button { padding: 10px 18px; background: #1d6ef5; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 0.95rem; font-weight: 500; white-space: nowrap; }\n' +
'    #input-row button:disabled { background: #2a2a2a; color: #555; cursor: not-allowed; }\n' +
'    .typing { font-style: italic; color: #777; }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <header>\n' +
'    <h1>' + esc(name) + '</h1>\n' +
'    <span class="model-badge">' + esc(model) + '</span>\n' +
'  </header>\n' +
'  <div id="messages"></div>\n' +
'  <div id="input-row">\n' +
'    <textarea id="prompt" rows="2" placeholder="Send a message... (Shift+Enter for newline)"></textarea>\n' +
'    <button id="send-btn" onclick="sendMessage()">Send</button>\n' +
'  </div>\n' +
'  <script>\n' +
'    var model = ' + JSON.stringify(model) + ';\n' +
'    var history = [];\n' +
'    var textarea = document.getElementById("prompt");\n' +
'    var sendBtn = document.getElementById("send-btn");\n' +
'    var messagesEl = document.getElementById("messages");\n' +
'\n' +
'    textarea.addEventListener("keydown", function(e) {\n' +
'      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }\n' +
'    });\n' +
'\n' +
'    function addMsg(role, text) {\n' +
'      var el = document.createElement("div");\n' +
'      el.className = "msg " + role;\n' +
'      el.textContent = text;\n' +
'      messagesEl.appendChild(el);\n' +
'      messagesEl.scrollTop = messagesEl.scrollHeight;\n' +
'      return el;\n' +
'    }\n' +
'\n' +
'    async function sendMessage() {\n' +
'      var text = textarea.value.trim();\n' +
'      if (!text) return;\n' +
'      textarea.value = "";\n' +
'      sendBtn.disabled = true;\n' +
'\n' +
'      addMsg("user", text);\n' +
'      history.push({ role: "user", content: text });\n' +
'\n' +
'      var replyEl = addMsg("assistant", "");\n' +
'      replyEl.classList.add("typing");\n' +
'      var replyText = "";\n' +
'\n' +
'      try {\n' +
'        var res = await fetch("/api/chat", {\n' +
'          method: "POST",\n' +
'          headers: { "Content-Type": "application/json" },\n' +
'          body: JSON.stringify({ model: model, messages: history, stream: true })\n' +
'        });\n' +
'        if (!res.ok) {\n' +
'          var errBody = await res.text();\n' +
'          throw new Error(res.status + " " + errBody);\n' +
'        }\n' +
'        var reader = res.body.getReader();\n' +
'        var decoder = new TextDecoder();\n' +
'        while (true) {\n' +
'          var result = await reader.read();\n' +
'          if (result.done) break;\n' +
'          var chunk = decoder.decode(result.value, { stream: true });\n' +
'          var lines = chunk.split("\\n").filter(Boolean);\n' +
'          for (var i = 0; i < lines.length; i++) {\n' +
'            try {\n' +
'              var data = JSON.parse(lines[i]);\n' +
'              if (data.message && data.message.content) {\n' +
'                replyText += data.message.content;\n' +
'                replyEl.textContent = replyText;\n' +
'                messagesEl.scrollTop = messagesEl.scrollHeight;\n' +
'              }\n' +
'            } catch (e) {}\n' +
'          }\n' +
'        }\n' +
'        replyEl.classList.remove("typing");\n' +
'        history.push({ role: "assistant", content: replyText });\n' +
'      } catch (err) {\n' +
'        replyEl.className = "msg error";\n' +
'        replyEl.textContent = "Error: " + err.message;\n' +
'      }\n' +
'\n' +
'      sendBtn.disabled = false;\n' +
'      textarea.focus();\n' +
'    }\n' +
'  </script>\n' +
'</body>\n' +
'</html>\n';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

exports.OllamaServer = OllamaServer;
exports.createServer = function (options) {
  return new OllamaServer(options);
};
