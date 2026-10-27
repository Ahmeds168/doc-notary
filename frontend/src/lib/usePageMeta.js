import { useEffect } from "react";

function setMeta(name, content) {
  let tag = document.head.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

/** Sets document.title and the meta description (and robots, for pages that shouldn't be indexed). */
export function usePageMeta({ title, description, noindex = false }) {
  useEffect(() => {
    document.title = title;
    setMeta("description", description);
    if (noindex) setMeta("robots", "noindex");
    else document.head.querySelector('meta[name="robots"]')?.remove();
  }, [title, description, noindex]);
}
