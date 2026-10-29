import { describe, it, expect, afterEach } from 'vitest';
import { parseRunOptions } from '../src/run.js';

const originalArgv = process.argv;

function setArgv(...args: string[]): void {
  process.argv = ['node', 'sentinel', 'run', ...args];
}

describe('run 参数解析（越界必须在入口被挡住）', () => {
  afterEach(() => {
    process.argv = originalArgv;
  });

  it('--port 正常值 → 收下', () => {
    setArgv('--port', '4321');
    expect(parseRunOptions().port).toBe(4321);
  });

  it('--port 超过 65535 → 明确报错，不能崩成裸 socket 错误', () => {
    // 以前只用 /^\\d+$/ 校验 → 70000 一直传到 createConnection，
    // 用户看到的是 "Fatal: Port should be >= 0 and < 65536" 这种底层错误。
    setArgv('--port', '70000');
    expect(() => parseRunOptions()).toThrow(/1-65535/);
  });

  it('--port 0 → 报错（0 = 让系统随机端口，等于白等 30s）', () => {
    setArgv('--port', '0');
    expect(() => parseRunOptions()).toThrow(/1-65535/);
  });

  it('--port 不是数字 → 报错说人话', () => {
    setArgv('--port', 'abc');
    expect(() => parseRunOptions()).toThrow(/必须是数字/);
  });

  it('--url 正常值 → 收下', () => {
    setArgv('--url', 'http://127.0.0.1:3000');
    expect(parseRunOptions().url).toBe('http://127.0.0.1:3000');
  });

  it('--url 不是 http(s) → 报错', () => {
    setArgv('--url', 'localhost:3000');
    expect(() => parseRunOptions()).toThrow(/http/);
  });

  it('没给 --port/--url → 两者都是 undefined（走自动推断）', () => {
    setArgv();
    const opts = parseRunOptions();
    expect(opts.port).toBeUndefined();
    expect(opts.url).toBeUndefined();
  });
});
