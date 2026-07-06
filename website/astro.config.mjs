import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://sproutgit.dev',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    starlight({
      title: 'SproutGit Docs',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/InterestingSoftware/SproutGit' },
      ],
      editLink: {
        baseUrl: 'https://github.com/InterestingSoftware/SproutGit/edit/main/website/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', slug: 'docs/getting-started/installation' },
            { label: 'Your first workspace', slug: 'docs/getting-started/first-workspace' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Worktree-first workflow', slug: 'docs/concepts/worktree-workflow' },
            { label: 'Workspace layout on disk', slug: 'docs/concepts/workspace-layout' },
            { label: 'Hooks & the trust model', slug: 'docs/concepts/hooks-and-trust' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Setting up a coding agent', slug: 'docs/guides/coding-agents' },
            { label: 'Writing hooks', slug: 'docs/guides/writing-hooks' },
            { label: 'Using the MCP server', slug: 'docs/guides/mcp-server' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Settings panel', slug: 'docs/reference/settings' },
            { label: 'Troubleshooting', slug: 'docs/reference/troubleshooting' },
          ],
        },
      ],
    }),
  ],
});
