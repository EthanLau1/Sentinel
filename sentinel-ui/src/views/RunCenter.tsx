import { useEffect, useState, useRef } from 'react';
import { useApp } from '../context/AppState';
import { apiClient } from '../api/client';
import type { UiRunRecord } from '../types';
import { Play, Square, Loader, CheckCircle, Terminal, ArrowRight, ArrowLeft } from 'lucide-react';

export function RunCenter() {
  const { state, navigate } = useApp();
  const project = state.projects.find((p) => p.id === state.selectedProjectId);

  const [isRunning, setIsRunning] = useState(false);
  const [runMode, setRunMode] = useState<'scan' | 'debug' | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [logs, setLogs] = useState<{ time: string; msg: string }[]>([]);
  const pendingRunRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [, setHistory] = useState<UiRunRecord[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const projectId = project?.id;

  useEffect(() => {
    if (!projectId) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const status = await apiClient.getRunStatus(projectId);
        if (!mounted) return;
        setHistory(status.history);
        setIsRunning(Boolean(status.active) || pendingRunRef.current);
        const active = status.active;
        if (active) {
          setRunMode(active.mode === 'run' ? 'debug' : 'scan');
          setLogs(
            active.events.map((e) => ({
              time: new Date(active.startedAt).toLocaleTimeString(),
              msg: e.message,
            }))
          );
          setCurrentStep(active.events.at(-1)?.step ?? 0);
        }
      } catch (err) {
        if (mounted) console.error('Failed to load run status', err);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [projectId]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center">
        <div className="text-sm font-semibold text-neutral-800">未选择项目</div>
        <div className="text-xs text-neutral-400 mt-1 mb-4">请从左侧导航或顶栏选择一个项目工作区。</div>
        <button
          onClick={() => navigate('quickstart')}
          className="btn-primary text-xs"
        >
          回到快速启航
        </button>
      </div>
    );
  }

  const runFlow = async (mode: 'scan' | 'debug') => {
    pendingRunRef.current = true;
    setIsRunning(true);
    setRunMode(mode);
    setCurrentStep(0);
    setLogs([
      {
        time: new Date().toLocaleTimeString(),
        msg: mode === 'scan' ? '正在启动项目架构扫描…' : '正在启动全链路缺陷诊断…',
      },
    ]);

    const runner = mode === 'scan' ? apiClient.scanProject : apiClient.runDebug;
    const result = await runner(project.id, (step, msg) => {
      setCurrentStep(step);
      setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
    });
    pendingRunRef.current = false;

    setIsRunning(false);
    if (result.success) setCurrentStep((prev) => (prev < 6 ? 6 : prev));
    setLogs((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        msg: result.success
          ? mode === 'scan'
            ? '扫描已完成。'
            : result.exitCode === 0
            ? '诊断完成：未发现致命缺陷。'
            : '诊断完成：已检出缺陷，报告已生成。'
          : result.exitCode !== undefined
          ? `运行异常退出码: ${result.exitCode}`
          : '运行异常终止',
      },
    ]);
  };

  const stopRun = async (): Promise<void> => {
    if (!project || stopping) return;
    setStopping(true);
    try {
      await fetch(`/api/projects/${encodeURIComponent(project.id)}/run/stop`, {
        method: 'POST',
      });
      setLogs((prev) => [
        ...prev,
        { time: new Date().toLocaleTimeString(), msg: '用户请求停止运行…' },
      ]);
    } catch (err) {
      console.error('Stop failed', err);
    } finally {
      setStopping(false);
    }
  };

  const pipelineSteps = [
    '项目理解与路由扫描 (Mapper)',
    '用户交互与流程探索 (Sensor)',
    '用例运行与现场采证 (Runner)',
    '规则判定与根因分析 (Analyst)',
    '反向验证与假设剔除 (Critic)',
    '生成修复杂与留档报告 (Reporter)',
  ];

  return (
    <div className="flex flex-col h-full justify-between">
      <div>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">
              执行全链路巡检
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              自动探测页面与接口拓扑，驱动真实无头浏览器采证，并闭环验证修复方案。
            </p>
          </div>
          <div className="border border-neutral-200 rounded px-2.5 py-1 text-xs font-mono text-neutral-500 uppercase tracking-wider">
            03 / RUN
          </div>
        </div>

        {/* Top Status Strip */}
        <div className="border border-neutral-200 rounded-xl p-3.5 flex items-center justify-between bg-white mt-5">
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-800">
            <span
              className={`status-dot ${isRunning ? 'status-dot-amber' : 'status-dot-green'}`}
            ></span>
            <span>
              {isRunning
                ? `巡检执行中 (${runMode === 'scan' ? '仅架构扫描' : '全流程诊断'})`
                : '运行通道就绪 · 等待触发'}
            </span>
            <span className="font-mono text-neutral-400">· {project.name}</span>
          </div>

          <div className="flex items-center gap-2">
            {isRunning && (
              <button
                onClick={() => void stopRun()}
                disabled={stopping}
                className="border border-neutral-200 bg-white rounded-lg px-3 py-1 text-xs text-neutral-700 font-medium hover:bg-neutral-50 transition cursor-pointer flex items-center gap-1.5"
              >
                <Square size={12} fill="currentColor" /> 停止运行
              </button>
            )}
          </div>
        </div>

        {/* Two-Card Grid - Responsive */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mt-4 sm:mt-5">
          {/* Card 1: 巡检触发与流水线 */}
          <div className="border border-neutral-200 rounded-xl p-5 bg-white flex flex-col justify-between">
            <div>
              <div className="font-bold text-sm text-neutral-900">
                触发操作与执行状态
              </div>
              <div className="text-xs text-neutral-500 mt-1 mb-4">
                点击一键启动自动化诊断，过程严格遵循黑匣子事件驱动。
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 mb-5">
                <button
                  onClick={() => runFlow('debug')}
                  disabled={isRunning}
                  className="btn-primary flex-1 justify-center"
                >
                  {isRunning && runMode === 'debug' ? (
                    <Loader className="animate-spin" size={14} />
                  ) : (
                    <Play size={14} />
                  )}
                  {isRunning && runMode === 'debug' ? '全链路诊断中…' : '启动全链路诊断'}
                </button>

                <button
                  onClick={() => runFlow('scan')}
                  disabled={isRunning}
                  className="btn-secondary"
                >
                  {isRunning && runMode === 'scan' ? '扫描中…' : '仅扫描架构'}
                </button>
              </div>

              {/* Step indicator */}
              <div className="flex flex-col gap-2">
                <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                  智能体流水线阶段
                </div>
                {pipelineSteps.map((name, idx) => {
                  const stepNumber = idx + 1;
                  const isDone = currentStep > stepNumber;
                  const isCurrent = currentStep === stepNumber;

                  return (
                    <div
                      key={idx}
                      className={`flex items-center gap-2.5 p-2 rounded-lg text-xs transition ${
                        isCurrent
                          ? 'bg-neutral-100 font-medium text-black'
                          : isDone
                          ? 'text-neutral-500'
                          : 'text-neutral-400'
                      }`}
                    >
                      {isDone ? (
                        <CheckCircle size={14} className="text-black flex-shrink-0" />
                      ) : isCurrent ? (
                        <span className="w-2 h-2 rounded-full bg-black flex-shrink-0 animate-ping"></span>
                      ) : (
                        <span className="w-2 h-2 rounded-full border border-neutral-300 flex-shrink-0"></span>
                      )}
                      <span className="font-mono text-neutral-400">0{stepNumber}</span>
                      <span className="truncate">{name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Card 2: 实时日志控制台 */}
          <div className="border border-neutral-200 rounded-xl p-5 bg-white flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="font-bold text-sm text-neutral-900 flex items-center gap-1.5">
                  <Terminal size={14} /> 运行事件与标准输出
                </div>
                <span className="font-mono text-xs text-neutral-400">
                  {logs.length} 行记录
                </span>
              </div>
              <div className="text-xs text-neutral-500 mb-3">
                实时捕获 Bus 事件与智能体通讯流水。
              </div>

              {/* Console window (Clean black box) */}
              <div className="w-full h-[260px] bg-black rounded-lg p-3.5 overflow-y-auto font-mono text-xs text-neutral-300 leading-relaxed border border-neutral-800">
                {logs.length === 0 ? (
                  <div className="text-neutral-500 italic py-4 text-center">
                    准备就绪。点击左侧按钮启动诊断。
                  </div>
                ) : (
                  logs.map((l, i) => (
                    <div key={i} className="mb-1">
                      <span className="text-neutral-500 mr-2">[{l.time}]</span>
                      <span className="text-neutral-200">{l.msg}</span>
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Informational Strips */}
        <div className="border border-neutral-200 bg-neutral-50/60 rounded-xl p-3 text-xs text-neutral-600 font-mono mt-5">
          事件录制: events.ndjson 持续落盘 · 宪法红线 6「案例永久留档」已激活
        </div>
        <div className="border border-neutral-200 bg-neutral-50/60 rounded-xl p-3 text-xs text-neutral-500 mt-2">
          若浏览器探针发现 HTTP 5xx 或致命错误，将自动截图存证并注入根因分析链。
        </div>
      </div>

      {/* Bottom Step Navigation */}
      <div className="border-t border-neutral-100 pt-5 mt-6 flex items-center justify-between">
        <div className="font-mono text-xs text-neutral-400 font-medium">
          03 / 05
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('overview')} className="btn-secondary">
            <ArrowLeft size={13} /> 02 诊断概览
          </button>
          <button onClick={() => navigate('debug')} className="btn-secondary">
            下一步: 缺陷工单 (04) <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
