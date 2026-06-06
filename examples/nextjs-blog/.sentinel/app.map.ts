// Sentinel FeatureMap 用户覆盖
// mapper 的输出会跟这里 merge

import type { FeatureMap } from '@sentinel/core';

const overrides: Partial<FeatureMap> = {
  // auth: {
  //   type: 'session',
  //   loginEndpoint: '/auth/login',
  //   sessionStorage: 'cookie',
  //   testCredentials: { email: 'sentinel@example.com', password: '...' },
  // },
  flows: [
    // {
    //   id: 'critical.create-post',
    //   description: '用户能成功发布帖子',
    //   steps: [
    //     { action: 'visit', url: '/posts/new' },
    //     { action: 'fill', selector: 'textarea', value: 'test' },
    //     { action: 'click', selector: 'button[type=submit]' },
    //   ],
    // },
  ],
};

export default overrides;
