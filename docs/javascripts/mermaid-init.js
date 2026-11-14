/*
 * Mermaid rendering for the Piezario docs.
 *
 * Why this file exists: Material for MkDocs 9.7 has a built-in Mermaid
 * integration, but on this project it swapped every fence for an empty
 * <div class="mermaid"></div> and never injected an SVG. So we emit the
 * fences as plain divs (see mkdocs.yml -> fence_div_format) and drive
 * Mermaid ourselves. Material's integration keys on <pre class="mermaid">,
 * which we never produce, so the two cannot collide.
 *
 * It also re-renders on the light/dark palette toggle, which is the one
 * thing you lose by not using the built-in integration.
 */
(function () {
  "use strict";

  var SELECTOR = "div.mermaid";

  function isDark() {
    var scheme = document.body.getAttribute("data-md-color-scheme");
    if (scheme) {
      return scheme === "slate";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function configure() {
    window.mermaid.initialize({
      startOnLoad: false,
      // "base" + explicit variables keeps the diagrams on Piezario's orange
      // rather than Mermaid's default lavender, in both palettes.
      theme: "base",
      themeVariables: isDark()
        ? {
            background: "#0a0a0a",
            primaryColor: "#7c2d12",
            primaryTextColor: "#f5f5f5",
            primaryBorderColor: "#c2410c",
            secondaryColor: "#1f2937",
            tertiaryColor: "#171717",
            lineColor: "#a8a29b",
            textColor: "#f5f5f5",
            mainBkg: "#1c1917",
            nodeBorder: "#c2410c",
            clusterBkg: "#171717",
            clusterBorder: "#3f3f46",
            noteBkgColor: "#292524",
            noteTextColor: "#f5f5f5",
            noteBorderColor: "#57534e",
            // ER attribute rows have their own fills; without these they
            // default to near-white and the attribute text vanishes.
            attributeBackgroundColorOdd: "#1c1917",
            attributeBackgroundColorEven: "#262322",
          }
        : {
            background: "#ffffff",
            primaryColor: "#fbe9dc",
            primaryTextColor: "#1a1a1a",
            primaryBorderColor: "#ea580c",
            secondaryColor: "#f5f5f4",
            tertiaryColor: "#fafaf9",
            lineColor: "#57534e",
            textColor: "#1a1a1a",
            mainBkg: "#fbf2eb",
            nodeBorder: "#ea580c",
            clusterBkg: "#fafaf9",
            clusterBorder: "#d6d3d1",
            noteBkgColor: "#fef3c7",
            noteTextColor: "#1a1a1a",
            noteBorderColor: "#d6d3d1",
            attributeBackgroundColorOdd: "#ffffff",
            attributeBackgroundColorEven: "#fbf2eb",
          },
      flowchart: { htmlLabels: true, curve: "basis", useMaxWidth: true },
      sequence: { useMaxWidth: true, wrap: true, width: 160 },
      state: { useMaxWidth: true },
      // The schema ERD has 14 entities with attribute lists. Scaled down to
      // the content width its labels are unreadable, so let it render at
      // natural size and scroll inside its own container (see extra.css).
      er: { useMaxWidth: false, entityPadding: 12, minEntityWidth: 120 },
      securityLevel: "loose",
    });
  }

  function render() {
    if (!window.mermaid) {
      return;
    }
    var nodes = document.querySelectorAll(SELECTOR);
    if (!nodes.length) {
      return;
    }
    // Stash the original source the first time round: rendering replaces the
    // element's contents with an SVG, so a re-render (palette toggle) has
    // nothing left to parse unless we kept it.
    Array.prototype.forEach.call(nodes, function (el) {
      if (el.dataset.mermaidSource === undefined) {
        el.dataset.mermaidSource = el.textContent;
      }
      el.removeAttribute("data-processed");
      el.innerHTML = el.dataset.mermaidSource;
    });
    configure();
    window.mermaid.run({ querySelector: SELECTOR, suppressErrors: false });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }

  // Material's palette toggle flips data-md-color-scheme on <body>.
  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].attributeName === "data-md-color-scheme") {
        render();
        return;
      }
    }
  }).observe(document.body, { attributes: true });
})();
