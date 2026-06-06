# nextjs-blog Demo

Sentinel 测试用的 Next.js 14 + Prisma 示例项目。

## Sentinel 测试

```bash
cd examples/nextjs-blog
sentinel init
sentinel doctor
sentinel map      # 应识别 nextjs + prisma + 3 routes
```

预期 mapper 输出：
- frameworks: ['nextjs', 'react', 'prisma']
- pages: 2 (/, /posts)
- api: 1 (/api/posts)
- data: 2 tables (User, Post)
