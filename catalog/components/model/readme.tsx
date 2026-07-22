import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { fileUrl } from "@/lib/urls";

/**
 * Renders a model's README body.
 *
 * READMEs are written to be read from inside the model's own folder, so they
 * reference siblings relatively (`![example](example_output.png)`). Those paths
 * mean nothing to the browser, which is sitting at /models/<slug>. Rewrite any
 * relative src/href onto the /files route so images actually load and links to
 * scripts actually resolve.
 */
function resolve(target: string | undefined, slug: string): string | undefined {
  if (!target) {
    return target;
  }
  // Absolute URLs, page anchors and root-relative paths are already fine.
  if (/^([a-z]+:|\/|#)/i.test(target)) {
    return target;
  }
  return fileUrl(`${slug}/${target.replace(/^\.\//, "")}`);
}

export function Readme({ body, slug }: { body: string; slug: string }) {
  return (
    <div className="readme">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolve(typeof src === "string" ? src : undefined, slug)}
              alt={alt ?? ""}
            />
          ),
          a: ({ href, children }) => (
            <a
              href={resolve(href, slug)}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noreferrer" : undefined}
            >
              {children}
            </a>
          ),
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}
