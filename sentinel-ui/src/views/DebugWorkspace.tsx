import { useState, useEffect } from 'react';
import { useApp } from '../context/AppState';
import { apiClient } from '../api/client';
import type { Bug, FixOption } from '../types';
import { ShieldAlert, ArrowLeft, ArrowRight, Copy, Check, FileCode } from 'lucide-react';

export function DebugWorkspace(): React.JSX.Element {
  const { state, navigate } = useApp();
  const project = state.projects.find((p) => p.id === state.selectedProjectId);
  const projectId = project?.id;

  const [bugs, setBugs] = useState<Bug[]>([]);
  const [selectedBugId, setSelectedBugId] = useState<string | null>(null);
  const [copiedFixId, setCopiedFixId] = useState<string | null>(null);

  const fetchBugs = () => {
    if (projectId) {
      apiClient.getBugs(projectId).then((data) => {
        setBugs(data);
        if (data.length > 0 && !selectedBugId) {
          setSelectedBugId(data[0].id);
        }
      }).catch(() => setBugs([]));
    }
  };

  useEffect(() => {
    fetchBugs();
  }, [projectId]);

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

  const handleCopyPatchCommand = async (_bugId: string, fixId: string): Promise<void> => {
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/patch/${encodeURIComponent(fixId)}`
      );
      if (!res.ok) throw new Error('该修复项暂未生成独立 patch 文件。');
      const data = (await res.json()) as { path: string };
      const cmd = `git apply ${data.path}`;
      await navigator.clipboard.writeText(cmd).catch(() => {
        window.prompt('复制此命令:', cmd);
      });
      setCopiedFixId(fixId);
      setTimeout(() => setCopiedFixId(null), 2500);
    } catch (err) {
      window.alert(String(err));
    }
  };

  const selectedBug = bugs.find((b) => b.id === selectedBugId) ?? bugs[0];

  return (
    <div className="flex flex-col h-full justify-between">
      <div>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">
              缺陷工单与补丁
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              审查智能体捕获的异常现场、根因推断链，并一键复制本地验证补丁。
            </p>
          </div>
          <div className="border border-neutral-200 rounded px-2.5 py-1 text-xs font-mono text-neutral-500 uppercase tracking-wider">
            04 / DEBUG
          </div>
        </div>

        {/* Top Status Strip */}
        <div className="border border-neutral-200 rounded-xl p-3.5 flex items-center justify-between bg-white mt-5">
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-800">
            <span
              className={`status-dot ${bugs.length > 0 ? 'status-dot-red' : 'status-dot-green'}`}
            ></span>
            <span>
              {bugs.length > 0 ? `共检出 ${bugs.length} 条有效缺陷` : '未检出缺陷，工作区状态健康'}
            </span>
            <span className="font-mono text-neutral-400">· {project.name}</span>
          </div>

          <button
            onClick={fetchBugs}
            className="border border-neutral-200 bg-white rounded-lg px-3 py-1 text-xs text-neutral-700 font-medium hover:bg-neutral-50 transition cursor-pointer"
          >
            刷新工单记录
          </button>
        </div>

        {/* Two-Card Grid - Responsive */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mt-4 sm:mt-5">
          {/* Card 1: 缺陷工单列表 */}
          <div className="border border-neutral-200 rounded-xl p-5 bg-white flex flex-col justify-between">
            <div>
              <div className="font-bold text-sm text-neutral-900">
                缺陷列表 ({bugs.length})
              </div>
              <div className="text-xs text-neutral-500 mt-1 mb-4">
                点击缺陷条目，右侧将展开对应的现场证据与修复选项。
              </div>

              {bugs.length === 0 ? (
                <div className="p-8 text-center text-xs text-neutral-400 border border-dashed border-neutral-200 rounded-xl">
                  当前工作区无未解决缺陷。可前往「执行巡检」重新运行。
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1">
                  {bugs.map((bug) => {
                    const isSelected = selectedBug?.id === bug.id;
                    return (
                      <div
                        key={bug.id}
                        onClick={() => setSelectedBugId(bug.id)}
                        className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'border-black bg-neutral-50 shadow-sm'
                            : 'border-neutral-200 hover:border-neutral-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`badge ${
                              bug.severity === 'P0'
                                ? 'badge-p0'
                                : bug.severity === 'P1'
                                ? 'badge-p1'
                                : 'badge-p2'
                            }`}
                          >
                            {bug.severity}
                          </span>
                          <div className="flex flex-col truncate max-w-[210px]">
                            <span className="text-xs font-semibold text-neutral-900 truncate">
                              {bug.title}
                            </span>
                            <span className="text-[11px] font-mono text-neutral-400 truncate">
                              {bug.affectedFeature}
                            </span>
                          </div>
                        </div>

                        <div className="text-right flex flex-col items-end text-[11px] font-mono text-neutral-400">
                          <span>{bug.evidence.length} 证据</span>
                          <span className="text-neutral-500">{bug.rootCauseStatus}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Card 2: 缺陷详情与补丁应用 */}
          <div className="border border-neutral-200 rounded-xl p-5 bg-white flex flex-col justify-between">
            {selectedBug ? (
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-neutral-100 mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`badge ${
                        selectedBug.severity === 'P0' ? 'badge-p0' : 'badge-p1'
                      }`}
                    >
                      {selectedBug.severity}
                    </span>
                    <span className="font-mono text-xs text-neutral-400">
                      {selectedBug.id}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-neutral-500">
                    可信度: {(selectedBug.confidence * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="font-bold text-sm text-neutral-900 mb-1">
                  {selectedBug.title}
                </div>
                {selectedBug.symptom && (
                  <div className="text-xs text-neutral-600 mb-3 bg-neutral-50 p-2.5 rounded-lg border border-neutral-100 font-mono">
                    {selectedBug.symptom}
                  </div>
                )}

                {/* Root Cause */}
                <div className="mb-3">
                  <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                    根因分析 (Root Cause)
                  </div>
                  <div className="text-xs text-neutral-800 leading-relaxed bg-white border border-neutral-200 p-2.5 rounded-lg">
                    {selectedBug.rootCause ?? '智能体根据异常现场正在推断可能成因…'}
                  </div>
                </div>

                {/* Fix Option */}
                {selectedBug.fixOptions.length > 0 ? (
                  <div>
                    <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                      修复选项 (Fix Option)
                    </div>
                    {selectedBug.fixOptions.slice(0, 1).map((opt: FixOption) => (
                      <div
                        key={opt.id}
                        className="border border-neutral-200 rounded-lg p-3 bg-neutral-50/50 flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-neutral-900">
                            {opt.description}
                          </span>
                          <span className="badge badge-p2">Tier {opt.tier}</span>
                        </div>

                        <button
                          onClick={() => handleCopyPatchCommand(selectedBug.id, opt.id)}
                          className="btn-primary w-full justify-center text-xs py-1.5 mt-1"
                        >
                          {copiedFixId === opt.id ? (
                            <>
                              <Check size={13} /> 已复制 git apply 命令
                            </>
                          ) : (
                            <>
                              <Copy size={13} /> 复制 git apply 补丁命令
                            </>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-neutral-400 italic py-2">
                    当前缺陷为观察性工单，暂未产出代码补丁。
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center text-neutral-400">
                <FileCode size={32} className="opacity-30 mb-2" />
                <div className="text-xs">选择左侧缺陷查看现场证据与补丁命令</div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Informational Strips */}
        <div className="border border-neutral-200 bg-neutral-50/60 rounded-xl p-3 text-xs text-neutral-600 font-mono mt-5">
          补丁留档路径: .sentinel/auto-patches/*.diff · 待审 PR 路径: reports/patches/*.patch
        </div>
        <div className="border border-neutral-200 bg-neutral-50/60 rounded-xl p-3 text-xs text-neutral-500 mt-2">
          所有修复方案由 Executor 遵循 Tier 判定约束生成，绝不静默改写生产代码。
        </div>
      </div>

      {/* Bottom Step Navigation */}
      <div className="border-t border-neutral-100 pt-5 mt-6 flex items-center justify-between">
        <div className="font-mono text-xs text-neutral-400 font-medium">
          04 / 05
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('run')} className="btn-secondary">
            <ArrowLeft size={13} /> 03 执行巡检
          </button>
          <button onClick={() => navigate('settings')} className="btn-secondary">
            下一步: 规则配置 (05) <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
