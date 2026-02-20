import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { load } from 'cheerio';
import url from 'url';

// A simple Vite plugin that provides a robust backend search route
// to bypass browser CORS and User-Agent restrictions naturally.
function searchBackendPlugin() {
  return {
    name: 'search-backend',
    configureServer(server: any) {
      server.middlewares.use('/api/real-search', async (req: any, res: any) => {
        try {
          const parsedUrl = url.parse(req.url, true);
          const query = parsedUrl.query.q as string;

          if (!query) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: 'Missing query' }));
          }

          console.log(`[Backend Search] Scraping DDG for: ${query}`);

          // Scrape DDG Lite (fastest, most text-heavy, least blocked)
          const params = new URLSearchParams({ q: query });
          const response = await fetch(`https://html.duckduckgo.com/html/?${params.toString()}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5'
            }
          });

          const html = await response.text();
          const $ = load(html);
          const results: any[] = [];

          $('.result').each((i, element) => {
            if (i >= 5) return false;

            const titleElement = $(element).find('.result__title a.result__a');
            const snippetElement = $(element).find('.result__snippet');

            if (titleElement.length && snippetElement.length) {
              let link = titleElement.attr('href') || '';
              if (link.includes('?uddg=')) {
                const match = link.match(/uddg=([^&]+)/);
                if (match) link = decodeURIComponent(match[1]);
              } else if (link.startsWith('//')) {
                link = 'https:' + link;
              }

              results.push({
                title: titleElement.text().trim(),
                link: link,
                snippet: snippetElement.text().trim(),
                source: 'DuckDuckGo Web'
              });
            }
          });

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ results }));

        } catch (e: any) {
          console.error("Backend Search Error:", e);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    }
  };
}

export default defineConfig({
  base: '/parasocial/',
  plugins: [
    react(),
    tailwindcss(),
    searchBackendPlugin()
  ],
  server: {
    proxy: {
      '/api/github-copilot': {
        target: 'https://api.githubcopilot.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/github-copilot/, '')
      },
      '/api/github': {
        target: 'https://api.github.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/github/, '')
      },
      '/github-oauth': {
        target: 'https://github.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/github-oauth/, '')
      },
      '/api/wiki': {
        target: 'https://en.wikipedia.org/w/api.php',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/wiki/, '')
      },
      '/api/weather': {
        target: 'https://api.open-meteo.com/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/weather/, '')
      }
    }
  }
});
