import { useState, useEffect } from 'react';
import { useApp } from '../context/AppState';
import { apiClient } from '../api/client';
import type { ReportJson } from '../types';
import { ShieldAlert, Play, FileText, FileJson, ArrowRight, ArrowLeft } from 'lucide-react';

export function ProjectOverview(): React.JSX.Element {
  const { state, navigate } = useApp();
  const project = state.projects.find((p) => p.id === state.selectedProjectId);
  const projectId = project?.id;
  const projectStatus = project?.status;
  const [report, setReport] = useState<ReportJson | null>(null);

  useEffect(() => {
    if (
      projectId &&
      (projectStatus === 'fresh' || projectStatus === 'possibly_stale' || projectStatus === 'stale')
    ) {
      apiClient.getReport(projectId).then(setReport).catch(() => setReport(null));
    } else {
      queueMicrotask(() => setReport(null));
    }
  }, [projectId, projectStatus]);

  const openReport = (ext: 'md' | 'json'): void => {
    if (!project) return;
    const url =
      ext === 'json'
        ? `/api/projects/${encodeURIComponent(project.id)}/report/latest`
        : `/api/projects/${encodeURIComponent(project.id)}/report/latest.md`;
    window.open(url, '_blank');
  };

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center">
        <ShieldAlert size={36} className="text-neutral-300 mb-2" />
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

  const costUsd = report?.summary?.cost_usd;
  const durationSec = report?.summary?.duration_seconds;
  const durationLabel =
    durationSec != null
      ? durationSec >= 60
        ? `${Math.floor(durationSec / 60)}分 ${durationSec % 60}秒`
        : `${durationSec}秒`
      : '—';

  const totalBugs = project.stats.p0 + project.stats.p1 + project.stats.p2 + project.stats.p3;

  return (
    <div className="flex flex-col h-full justify-between animate-fade-in w-full max-w-4xl">
      <div>
        {/* Header - Balanced line height */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-neutral-100">
          <div>
            <h1 className="text-xl font-bold text-neutral-900 tracking-tight">
              诊断概览
            </h1>
            <p className="text-xs text-neutral-500 mt-1">
              当前工作区最近一次巡检结果与缺陷分布。
            </p>
          </div>
          <span className="text-tiny font-mono text-neutral-400 bg-neutral-50 px-2 py-0.5 rounded border border-neutral-200">
            02 / OVERVIEW
          </span>
        </div>

        {/* Top Status Strip - Responsive wrap */}
        <div className="border border-neutral-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 bg-white mt-4">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-neutral-800 min-w-0">
            <span
              className={`status-dot ${
                project.status === 'fresh'
                  ? 'status-dot-green'
                  : project.status === 'possibly_stale' || project.status === 'stale'
                  ? 'status-dot-amber'
                  : 'bg-neutral-300'
              }`}
            ></span>
            <span className="font-semibold text-neutral-900">{project.name}</span>
            <span className="text-neutral-300">|</span>
            <span className="font-mono text-neutral-500 text-xs truncate max-w-xs">{project.path}</span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => navigate('run')}
              className="btn-primary text-xs py-1 px-3 min-h-[30px]"
            >
              <Play size={10} fill="white" />
              <span>重新巡检</span>
            </button>
            <button
              onClick={() => navigate('quickstart')}
              className="btn-secondary text-xs py-1 px-2.5 min-h-[30px]"
            >
              切换模型
            </button>
          </div>
        </div>

        {/* Two-Card Grid - Responsive Stack on smaller screens */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {/* Card 1: 缺陷统计 */}
          <div className="border border-neutral-200 rounded-xl p-4 sm:p-5 bg-white flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-neutral-800 uppercase tracking-wide">
                  缺陷分布
                </span>
                <span className="text-xs font-mono font-bold text-neutral-900">
                  共 {totalBugs} 项
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center mb-4">
                <div className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-100">
                  <div className="text-xs text-neutral-500">致命 (P0)</div>
                  <div className="text-xl sm:text-2xl font-bold font-mono text-red-600 mt-1">{project.stats.p0}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-100">
                  <div className="text-xs text-neutral-500">严重 (P1)</div>
                  <div className="text-xl sm:text-2xl font-bold font-mono text-amber-600 mt-1">{project.stats.p1}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-100">
                  <div className="text-xs text-neutral-500">警告 (P2/3)</div>
                  <div className="text-xl sm:text-2xl font-bold font-mono text-neutral-700 mt-1">
                    {project.stats.p2 + project.stats.p3}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-neutral-100">
              <button
                onClick={() => navigate('debug')}
                className="btn-primary flex-1 justify-center text-xs min-h-[34px]"
              >
                查看缺陷工单
              </button>
              <button
                onClick={() => openReport('md')}
                className="btn-secondary text-xs min-h-[34px]"
                title="打开 Markdown 报告"
              >
                <FileText size={13} /> 报告
              </button>
              <button
                onClick={() => openReport('json')}
                className="btn-secondary text-xs min-h-[34px]"
                title="导出 JSON 数据"
              >
                <FileJson size={13} /> JSON
              </button>
            </div>
          </div>

          {/* Card 2: 运行指标 */}
          <div className="border border-neutral-200 rounded-xl p-4 sm:p-5 bg-white flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-neutral-800 uppercase tracking-wide">
                  运行指标
                </span>
                <span className="text-xs font-mono text-neutral-400">
                  {project.lastRunTime ? new Date(project.lastRunTime).toLocaleDateString() : '尚未运行'}
                </span>
              </div>

              <div className="flex flex-col gap-2 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-50 border border-neutral-100 min-h-[34px]">
                  <span className="text-neutral-500">状态</span>
                  <span className="font-medium text-neutral-800">
                    {project.status === 'fresh' ? '最新已就绪' : project.status}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-50 border border-neutral-100 min-h-[34px]">
                  <span className="text-neutral-500">耗时 / 开销</span>
                  <span className="font-mono text-neutral-800">
                    {durationLabel} · {costUsd != null ? `$${costUsd.toFixed(4)}` : '$0.00'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-50 border border-neutral-100 min-h-[34px]">
                  <span className="text-neutral-500">推理通道</span>
                  <span className="font-mono text-neutral-700 truncate max-w-[140px]">
                    {project.provider}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-neutral-100">
              <button
                onClick={() => navigate('run')}
                className="btn-primary w-full justify-center text-xs min-h-[34px]"
              >
                <Play size={12} fill="currentColor" /> 进入执行中心
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Step Navigation */}
      <div className="border-t border-neutral-100 pt-4 mt-6 flex items-center justify-between text-xs">
        <span className="font-mono text-neutral-400">02 / 05</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('quickstart')}
            className="btn-secondary text-xs min-h-[32px] px-3 py-1"
          >
            <ArrowLeft size={12} />
            <span>01 快速启航</span>
          </button>
          <button
            onClick={() => navigate('run')}
            className="btn-primary text-xs min-h-[32px] px-3.5 py-1"
          >
            <span>下一步: 执行巡检 (03)</span>
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
