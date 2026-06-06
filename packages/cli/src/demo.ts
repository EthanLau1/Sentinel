import type { BugFinding, Evidence, FixOption } from '@sentinel/core';

const now = () => Date.now();

function consoleEvidence(hash: string): Evidence {
  return {
    hash,
    timestamp: now(),
    source: 'browser',
    kind: 'console',
    level: 'error',
    message: 'TypeError: submitPost is not a function',
  };
}

function networkEvidence(hash: string): Evidence {
  return {
    hash,
    timestamp: now(),
    source: 'browser',
    kind: 'network',
    url: '/api/posts',
    method: 'POST',
    status: 500,
    duration_ms: 420,
    failed: true,
  };
}

function httpEvidence(hash: string): Evidence {
  return {
    hash,
    timestamp: now(),
    source: 'api',
    kind: 'http',
    url: '/api/settings/profile',
    method: 'PATCH',
    status: 401,
  };
}

function fileEvidence(hash: string): Evidence {
  return {
    hash,
    timestamp: now(),
    source: 'fs',
    kind: 'file',
    path: 'app/feed/page.tsx',
    snippet: 'button onClick={submitPost}',
  };
}

function fix(id: string, title: string, tier: 1 | 2 | 3, score: number): FixOption {
  return {
    id,
    title,
    description: title,
    effort: tier === 1 ? 'low' : tier === 2 ? 'medium' : 'high',
    risk: tier === 1 ? 'low' : tier === 2 ? 'low' : 'medium',
    runtimeCost: 'none',
    regressionRisk: tier === 1 ? 'medium' : 'low',
    maintenanceCost: tier === 1 ? 'medium' : 'low',
    stageFit: tier === 1 ? 'MVP' : tier === 2 ? 'Launch' : 'Scale',
    tier,
    confidence: tier === 1 ? 0.82 : tier === 2 ? 0.9 : 0.72,
    score,
    sources: [],
    whyRecommended: tier === 1 ? 'MVP 阶段优先恢复主流程' : '更完整但成本更高',
  };
}

export function demoBugs(): BugFinding[] {
  return [
    {
      id: 'demo_publish_button_no_response',
      title: 'Publish button does not submit the post',
      severity: 'P1',
      source: 'ui',
      affectedFeature: 'Feed / Publish',
      symptom: 'Clicking Publish leaves the draft on screen and no post appears.',
      reproSteps: ['Open /feed', 'Type a post', 'Click Publish', 'Observe no post is created'],
      evidence: [
        consoleEvidence('demo-console-submit-missing'),
        fileEvidence('demo-file-feed-page'),
      ],
      rootCauseStatus: 'confirmed',
      rootCause: 'The Publish button calls submitPost, but the handler is not wired in the page component.',
      counterEvidence: [],
      confidence: 0.88,
      verificationCommand: 'sentinel run --project=/path/to/your-app',
      fixOptions: [
        fix('demo_publish_quick', 'Wire the Publish button to the existing createPost action', 1, 0.91),
        fix('demo_publish_standard', 'Add submit state, error handling, and a regression test for publish flow', 2, 0.84),
        fix('demo_publish_longterm', 'Extract publish flow into a tested feature module with telemetry', 3, 0.62),
      ],
      recommendedFixId: 'demo_publish_quick',
    },
    {
      id: 'demo_profile_settings_unauthorized',
      title: 'Profile settings save returns 401',
      severity: 'P1',
      source: 'auth',
      affectedFeature: 'Settings / Profile',
      symptom: 'Saving profile changes fails after login.',
      reproSteps: ['Login as a test user', 'Open /settings/profile', 'Change display name', 'Click Save'],
      evidence: [
        httpEvidence('demo-http-profile-401'),
      ],
      rootCauseStatus: 'hypothesis',
      rootCause: 'The profile settings request is missing the session cookie or Authorization header.',
      counterEvidence: [],
      confidence: 0.73,
      verificationCommand: 'sentinel run --project=/path/to/your-app',
      fixOptions: [
        fix('demo_profile_quick', 'Attach session credentials to the profile update request', 1, 0.86),
        fix('demo_profile_standard', 'Centralize authenticated fetch and add a settings save test', 2, 0.82),
        fix('demo_profile_longterm', 'Move auth state into a shared client and server contract', 3, 0.58),
      ],
      recommendedFixId: 'demo_profile_quick',
    },
    {
      id: 'demo_posts_api_500',
      title: 'Posts API returns 500 during create',
      severity: 'P0',
      source: 'api',
      affectedFeature: 'API / Posts',
      symptom: 'POST /api/posts returns a server error.',
      reproSteps: ['Open /feed', 'Submit a new post', 'Inspect network request'],
      evidence: [
        networkEvidence('demo-network-posts-500'),
      ],
      rootCauseStatus: 'hypothesis',
      rootCause: 'The create-post API likely reaches the database layer without a valid required field.',
      counterEvidence: [],
      confidence: 0.69,
      verificationCommand: 'sentinel run --project=/path/to/your-app',
      fixOptions: [
        fix('demo_posts_quick', 'Validate required post fields before calling the database', 1, 0.79),
        fix('demo_posts_standard', 'Add schema validation and API integration coverage for create post', 2, 0.83),
        fix('demo_posts_longterm', 'Introduce a typed API contract shared by client and server', 3, 0.64),
      ],
      recommendedFixId: 'demo_posts_standard',
    },
  ];
}
