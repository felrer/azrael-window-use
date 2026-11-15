'use strict';
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ReadBuffer, serializeMessage } = require('@modelcontextprotocol/sdk/shared/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { toolDefinitions, callResult } = require('../vendor/azrael/window-control-mcp.cjs');
const { randomUUID } = require('node:crypto');
class SocketTransport {
  constructor(socket) { this.socket = socket; this.buffer = new ReadBuffer(); }
  async start() {
    this.socket.on('data',chunk=>{try{this.buffer.append(chunk);let message;while((message=this.buffer.readMessage())!==null)this.onmessage?.(message);}catch(error){this.onerror?.(error);this.socket.destroy();}});
    this.socket.on('error',error=>this.onerror?.(error));
    this.socket.on('close',()=>this.onclose?.());
  }
  async send(message) { await new Promise((resolve,reject)=>this.socket.write(serializeMessage(message),error=>error?reject(error):resolve())); }
  async close() { this.socket.end(); }
}
async function startMcp({ runtime, log, onClient, onClose, transport }) {
  const server = new Server({ name: 'az_window_use', version: '0.1.0' }, { capabilities: { tools: {} } });
  const definitions = toolDefinitions();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const requestId = randomUUID(), started = Date.now(), tool = request.params.name;
    log('info','mcp','request_started',{requestId,connectionId:runtime.thread,tool});
    try {
      if (!definitions.some(def => def.name === tool)) throw Object.assign(new Error('지원하지 않는 도구입니다.'), { code:'unsupported_action' });
      const result = await runtime.call(tool, request.params.arguments || {}, extra.signal);
      log('info','mcp','request_finished',{requestId,tool,durationMs:Date.now()-started});
      return callResult(result);
    } catch (error) {
      const code = /^[a-z_]{1,64}$/.test(error.code || '') ? error.code : 'execution_error';
      log('warn','mcp','request_failed',{requestId,tool,code,nativeCode:error.nativeCode,durationMs:Date.now()-started});
      // A native mutation may have partially executed. Do not turn unknown outcomes into safe retries.
      const result = { code, message: error.message || '작업을 완료하지 못했습니다.' };
      for (const key of ['actionExecuted','mutationOutcome','observationRequired','recovery','pauseReason','nativeCode','stage']) if (error[key] !== undefined) result[key] = error[key];
      if(error.switchedInputDetails)result.switchedInputDetails=require('../vendor/azrael/window-control-errors.cjs').switchedMetadata(error.switchedInputDetails);
      return { isError: true, content: [{ type:'text',text:JSON.stringify(result) }] };
    }
  });
  server.oninitialized = () => onClient?.(server.getClientVersion()?.name || 'MCP client');
  server.onerror = error => log('error','mcp','transport_error',{code:error.code});
  server.onclose = () => onClose?.();
  await server.connect(transport || new StdioServerTransport());
  return server;
}
module.exports = { startMcp, SocketTransport };
