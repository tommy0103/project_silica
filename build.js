import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';
import container from 'markdown-it-container';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, 'posts');
const DIST_DIR = path.join(__dirname, 'dist');
const TEMPLATE_PATH = path.join(__dirname, 'template.html');

const CN_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];

function buildPost(postDir) {
  const mdPath = path.join(postDir, 'index.md');
  if (!fs.existsSync(mdPath)) return;

  const raw = fs.readFileSync(mdPath, 'utf-8');
  const { data: fm, content: mdContent } = matter(raw);

  let chapterIndex = 0;

  const md = new MarkdownIt({ html: true, typographer: true });

  // --- Custom container: diagram ---
  md.use(container, 'diagram', {
    validate: (params) => params.trim().startsWith('diagram'),
    render: (tokens, idx) => {
      if (tokens[idx].nesting === 1) {
        const params = tokens[idx].info.trim().slice('diagram'.length).trim();
        const svgFile = params;
        const svgPath = path.join(postDir, svgFile);
        let svgContent = '';
        if (fs.existsSync(svgPath)) {
          svgContent = fs.readFileSync(svgPath, 'utf-8');
        } else {
          svgContent = `<!-- SVG not found: ${svgFile} -->`;
        }
        return `<div class="diagram">\n${svgContent}\n<div class="diagram-caption">`;
      } else {
        return `</div>\n</div>\n`;
      }
    },
  });

  // --- Custom container: evidence ---
  md.use(container, 'evidence', {
    validate: (params) => params.trim().startsWith('evidence'),
    render: (tokens, idx) => {
      if (tokens[idx].nesting === 1) {
        const params = tokens[idx].info.trim().slice('evidence'.length).trim();
        const match = params.match(/^(\S+)\s+"([^"]+)"/);
        const filename = match ? match[1] : params.split(/\s/)[0];
        const stat = match ? match[2] : '';
        const evidencePath = path.join(postDir, filename);

        let evidenceHtml = '';
        if (fs.existsSync(evidencePath)) {
          const evidenceMd = fs.readFileSync(evidencePath, 'utf-8');
          const evidenceRenderer = new MarkdownIt({ html: true });
          evidenceHtml = evidenceRenderer.render(evidenceMd);
        } else {
          evidenceHtml = `<p><!-- File not found: ${filename} --></p>`;
        }

        return `<div class="evidence-section">\n<p class="evidence-intro">`;
      } else {
        return '';
      }
    },
  });

  // We need a more sophisticated approach for evidence since the body
  // (intro text) is between the opening and closing fence.
  // Let's use a pre-processing approach instead.

  // --- Actually, let's do a two-pass approach ---
  // First pass: extract and replace custom blocks, then render markdown.

  const rendered = renderMarkdown(mdContent, postDir);

  // Wrap h2s in section.chapter with auto-numbered idx
  const finalHtml = wrapChapters(rendered);

  // Build title HTML
  let titleHtml = escapeHtml(fm.title || '');
  if (fm.alt) {
    titleHtml = titleHtml.replace(fm.alt, `<span class="alt">${escapeHtml(fm.alt)}</span>`);
  }

  // Load template and fill placeholders
  let template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const replacements = {
    '{{title}}': fm.title || '',
    '{{titleHtml}}': titleHtml,
    '{{hero}}': fm.hero || '',
    '{{lede}}': fm.lede || '',
    '{{date}}': fm.date || '',
    '{{readTime}}': String(fm.readTime || ''),
    '{{repo}}': fm.repo || '#',
    '{{repoName}}': fm.repoName || fm.repo || '',
    '{{footerLine1}}': fm.footerLine1 || '',
    '{{footerLine2}}': fm.footerLine2 || '',
    '{{content}}': finalHtml,
  };

  for (const [key, val] of Object.entries(replacements)) {
    template = template.replaceAll(key, val);
  }

  // Write output
  const postName = path.basename(postDir);
  const outDir = path.join(DIST_DIR, postName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), template, 'utf-8');
  console.log(`  built: dist/${postName}/index.html`);
}

function renderMarkdown(content, postDir) {
  // Pre-process: handle ::: evidence and ::: diagram blocks manually
  // because evidence needs special multi-part rendering.
  const lines = content.split('\n');
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const diagramMatch = lines[i].match(/^:::\s*diagram\s+(.+)$/);
    const evidenceMatch = lines[i].match(/^:::\s*evidence\s+(\S+)\s+"([^"]+)"$/);
    const calloutMatch = lines[i].match(/^:::\s*callout\s*$/);

    if (diagramMatch) {
      const svgFile = diagramMatch[1].trim();
      i++;
      const captionLines = [];
      while (i < lines.length && lines[i].trim() !== ':::') {
        captionLines.push(lines[i]);
        i++;
      }
      i++; // skip closing :::
      const caption = captionLines.join('\n').trim();
      const svgPath = path.join(postDir, svgFile);
      let svgContent = fs.existsSync(svgPath)
        ? fs.readFileSync(svgPath, 'utf-8')
        : `<!-- SVG not found: ${svgFile} -->`;
      output.push(`<div class="diagram">`);
      output.push(svgContent);
      if (caption) {
        output.push(`<div class="diagram-caption">${caption}</div>`);
      }
      output.push(`</div>`);
    } else if (evidenceMatch) {
      const filename = evidenceMatch[1];
      const stat = evidenceMatch[2];
      i++;
      const introLines = [];
      while (i < lines.length && lines[i].trim() !== ':::') {
        introLines.push(lines[i]);
        i++;
      }
      i++; // skip closing :::
      const introMd = introLines.join('\n').trim();
      const introRenderer = new MarkdownIt({ html: true });
      const introHtml = introRenderer.renderInline(introMd);

      const evidencePath = path.join(postDir, filename);
      let evidenceHtml = '';
      if (fs.existsSync(evidencePath)) {
        const evidenceMd = fs.readFileSync(evidencePath, 'utf-8');
        const evidenceRenderer = new MarkdownIt({ html: true });
        evidenceHtml = evidenceRenderer.render(evidenceMd);
      } else {
        evidenceHtml = `<p><!-- File not found: ${filename} --></p>`;
      }

      output.push(`<div class="evidence-section">`);
      if (introHtml) {
        output.push(`<p class="evidence-intro">${introHtml}</p>`);
      }
      output.push(`<details class="evidence">`);
      output.push(`<summary>`);
      output.push(`<div class="evidence-meta">`);
      output.push(`<span class="evidence-filename">${escapeHtml(filename)}</span>`);
      output.push(`<span class="evidence-stat">${escapeHtml(stat)}</span>`);
      output.push(`</div>`);
      output.push(`<span class="evidence-toggle"></span>`);
      output.push(`</summary>`);
      output.push(`<div class="evidence-body">`);
      output.push(evidenceHtml);
      output.push(`</div>`);
      output.push(`</details>`);
      output.push(`</div>`);
    } else if (calloutMatch) {
      i++;
      const calloutLines = [];
      while (i < lines.length && lines[i].trim() !== ':::') {
        calloutLines.push(lines[i]);
        i++;
      }
      i++; // skip closing :::
      const calloutMd = calloutLines.join('\n').trim();
      const calloutRenderer = new MarkdownIt({ html: true });
      const calloutHtml = calloutRenderer.render(calloutMd);
      output.push(`<div class="callout">`);
      output.push(calloutHtml);
      output.push(`</div>`);
    } else {
      output.push(lines[i]);
      i++;
    }
  }

  // Now render the remaining markdown (non-custom-block parts)
  const combined = output.join('\n');

  // Split into HTML blocks (already rendered) and markdown blocks
  const segments = splitHtmlAndMd(combined);
  let result = '';
  const mdRenderer = new MarkdownIt({ html: true, typographer: true });
  for (const seg of segments) {
    if (seg.type === 'html') {
      result += seg.content;
    } else {
      result += mdRenderer.render(seg.content);
    }
  }
  return result;
}

function splitHtmlAndMd(content) {
  // Custom blocks output raw HTML starting with <div class="diagram/evidence/callout">
  // We need to keep those as-is and render the rest as markdown.
  const segments = [];
  const lines = content.split('\n');
  let current = { type: 'md', lines: [] };

  let htmlDepth = 0;
  for (const line of lines) {
    if (htmlDepth === 0 && line.match(/^<div class="(diagram|evidence-section|callout)">/)) {
      if (current.lines.length > 0) {
        segments.push({ type: current.type, content: current.lines.join('\n') });
      }
      current = { type: 'html', lines: [line] };
      htmlDepth = 1;
    } else if (htmlDepth > 0) {
      current.lines.push(line);
      // Count nested divs
      const opens = (line.match(/<div[\s>]/g) || []).length;
      const closes = (line.match(/<\/div>/g) || []).length;
      htmlDepth += opens - closes;
      if (htmlDepth <= 0) {
        segments.push({ type: 'html', content: current.lines.join('\n') });
        current = { type: 'md', lines: [] };
        htmlDepth = 0;
      }
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) {
    segments.push({ type: current.type, content: current.lines.join('\n') });
  }
  return segments;
}

function wrapChapters(html) {
  // Protect evidence-body content from h2 splitting
  const protectedBlocks = [];
  let safeHtml = html.replace(/<div class="evidence-body">[\s\S]*?<\/div>\s*<\/details>\s*<\/div>/g, (match) => {
    const idx = protectedBlocks.length;
    protectedBlocks.push(match);
    return `<!--PROTECTED_${idx}-->`;
  });

  // Split on h2 tags and wrap each in <section class="chapter">
  const parts = safeHtml.split(/(<h2>[\s\S]*?<\/h2>)/);
  let result = '';
  let chapterIdx = 0;
  let inChapter = false;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.match(/^<h2>/)) {
      if (inChapter) {
        result += '</section>\n';
      }
      const numeral = CN_NUMERALS[chapterIdx] || String(chapterIdx + 1);
      const h2Content = part.replace(/<h2>([\s\S]*?)<\/h2>/, (_, inner) => {
        return `<h2><span class="idx">${numeral}</span>${inner.trim()}</h2>`;
      });
      result += `<section class="chapter">\n${h2Content}\n`;
      inChapter = true;
      chapterIdx++;
    } else {
      result += part;
    }
  }
  if (inChapter) {
    result += '</section>\n';
  }

  // Restore protected blocks
  result = result.replace(/<!--PROTECTED_(\d+)-->/g, (_, idx) => protectedBlocks[Number(idx)]);
  return result;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Main ---
console.log('Building posts...');
const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

if (!fs.existsSync(POSTS_DIR)) {
  console.log('No posts/ directory found.');
  process.exit(0);
}

const posts = fs.readdirSync(POSTS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => path.join(POSTS_DIR, d.name));

if (posts.length === 0) {
  console.log('No posts found.');
  process.exit(0);
}

fs.mkdirSync(DIST_DIR, { recursive: true });
for (const postDir of posts) {
  buildPost(postDir);
}
console.log('Done.');
