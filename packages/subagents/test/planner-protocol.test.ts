import { describe, it, expect } from 'vitest';
import { splitPlannerOutput } from '../src/planner.js';

describe('planner 输出协议 — JSON 元数据 + PATCH 文本段', () => {
  it('拆出 JSON 段与 PATCH 段', () => {
    const raw = `<think>reasoning</think>
===JSON===
[
  {"id":"b_fix_1","title":"t1","description":"d1","effort":"low","risk":"low","runtimeCost":"none","regressionRisk":"low","maintenanceCost":"none","stageFit":"MVP","tier":1,"confidence":0.8,"whyRecommended":"w","verificationCommand":"npm test"},
  {"id":"b_fix_2","title":"t2","description":"d2","effort":"medium","risk":"low","runtimeCost":"none","regressionRisk":"low","maintenanceCost":"none","stageFit":"MVP","tier":2,"confidence":0.7,"whyRecommended":"w","verificationCommand":"npm test"},
  {"id":"b_fix_3","title":"t3","description":"d3","effort":"high","risk":"low","runtimeCost":"none","regressionRisk":"low","maintenanceCost":"none","stageFit":"MVP","tier":3,"confidence":0.6,"whyRecommended":"w","verificationCommand":"npm test"}
]
===END===

===PATCH b_fix_1===
--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -1 +1 @@
-old
+new
===END===

===PATCH b_fix_2===
--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -5,3 +5,5 @@
 ctx
-old line
+new line
+extra
===END===`;
    const { jsonText, patches } = splitPlannerOutput(raw);
    expect(jsonText.trim().startsWith('[')).toBe(true);
    expect(JSON.parse(jsonText)).toHaveLength(3);
    expect(patches.get('b_fix_1')).toContain('+new');
    expect(patches.get('b_fix_1')).toContain('@@ -1 +1 @@');
    expect(patches.get('b_fix_2')).toContain('+extra');
    expect(patches.has('b_fix_3')).toBe(false);
  });

  it('patch 里的引号与反斜杠原样保留（不需要任何转义）', () => {
    const raw = `===JSON===
[]
===END===
===PATCH x===
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+const s = "he said \\"hi\\"";
===END===`;
    const { patches } = splitPlannerOutput(raw);
    expect(patches.get('x')).toContain('"he said');
  });

  it('模型不遵守协议、只输出裸 JSON → 退回整段解析', () => {
    const raw = '[{"id":"a"}]';
    const { jsonText, patches } = splitPlannerOutput(raw);
    expect(jsonText).toBe(raw);
    expect(patches.size).toBe(0);
  });

  it('JSON 段未闭合 ===END=== → 也能取出 JSON 部分', () => {
    const raw = '===JSON===\n[{"id":"a"}]\n';
    const { jsonText } = splitPlannerOutput(raw);
    expect(jsonText.trim()).toBe('[{"id":"a"}]');
  });

  it('没有 PATCH 段 → 空 map', () => {
    const { patches } = splitPlannerOutput('===JSON===\n[]\n===END===');
    expect(patches.size).toBe(0);
  });
});
