import { Fragment, type ReactNode } from 'react';

// Minimal Markdown for the legal pages: headings (#, ##, ###), bulleted lists (- item), paragraphs
// and **bold**. The sources are our own files under content/legal, so no HTML or links are parsed.

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={index} className="font-medium text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'paragraph'; text: string };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: 'heading',
        level: (heading[1]?.length ?? 1) as 1 | 2 | 3,
        text: heading[2] ?? '',
      });
    } else if (line.startsWith('- ')) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.type === 'list') last.items.push(line.slice(2));
      else blocks.push({ type: 'list', items: [line.slice(2)] });
    } else if (line === '') {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-space-md font-body text-body text-ink-muted">
      {parse(source).map((block, index) => {
        switch (block.type) {
          case 'heading':
            return block.level === 1 ? (
              <h1
                key={index}
                className="font-display-l-mobile text-display-l-mobile text-ink md:font-display-l md:text-display-l"
              >
                {block.text}
              </h1>
            ) : block.level === 2 ? (
              <h2
                key={index}
                className="pt-space-md font-heading-mobile text-heading-mobile text-ink"
              >
                {block.text}
              </h2>
            ) : (
              <h3 key={index} className="font-heading-mobile text-body text-ink">
                {block.text}
              </h3>
            );
          case 'list':
            return (
              <ul key={index} className="list-disc space-y-space-xs pl-space-lg">
                {block.items.map((item) => (
                  <li key={item}>{inline(item)}</li>
                ))}
              </ul>
            );
          case 'paragraph':
            return <p key={index}>{inline(block.text)}</p>;
        }
      })}
    </div>
  );
}
