<script lang="ts">
  import type { Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import Icon from './Icon.svelte';

  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    children: Snippet;
  }

  const { open, title, onclose, children }: Props = $props();

  // Matches ribbon.md's mobile breakpoint.
  const isMobile = new MediaQuery('max-width: 599px');

  let panelEl: HTMLDivElement | undefined = $state();
  let previouslyFocused: HTMLElement | null = null;

  function focusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  $effect(() => {
    if (!open) return;
    previouslyFocused = document.activeElement as HTMLElement | null;
    const target = panelEl ? (focusableElements(panelEl)[0] ?? panelEl) : null;
    target?.focus();

    return () => {
      previouslyFocused?.focus();
      previouslyFocused = null;
    };
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
      return;
    }

    if (event.key !== 'Tab' || !panelEl) return;
    const focusable = focusableElements(panelEl);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

{#if open}
  <button type="button" class="overlay-backdrop" onclick={onclose} aria-label="Close {title}"
  ></button>
  <div
    bind:this={panelEl}
    class="overlay-panel"
    class:sheet={isMobile.current}
    class:drawer={!isMobile.current}
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <div class="overlay-header">
      <span class="overlay-title">{title}</span>
      <button type="button" class="overlay-close" onclick={onclose} aria-label="Close {title}">
        <Icon name="close" />
      </button>
    </div>
    <div class="overlay-body">
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .overlay-backdrop {
    position: fixed;
    inset: 0;
    border: none;
    background: rgb(0 0 0 / 0.4);
    z-index: 40;
    cursor: default;
  }

  .overlay-panel {
    position: fixed;
    z-index: 41;
    background: #181828;
    color: #f0f0ff;
    display: flex;
    flex-direction: column;
    box-shadow: -6px 0 24px rgb(0 0 0 / 0.35);
  }

  .overlay-panel.drawer {
    top: var(--top-bar-height);
    right: 0;
    height: calc(100% - var(--top-bar-height));
    width: min(360px, 88vw);
    border-left: 1px solid #2a2a45;
    animation: slide-in-right 0.16s ease-out;
  }

  .overlay-panel.sheet {
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 78vh;
    border-top: 1px solid #2a2a45;
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -6px 24px rgb(0 0 0 / 0.35);
    animation: slide-in-up 0.16s ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay-panel {
      animation: none;
    }
  }

  @keyframes slide-in-right {
    from {
      transform: translateX(16px);
      opacity: 0;
    }
  }

  @keyframes slide-in-up {
    from {
      transform: translateY(16px);
      opacity: 0;
    }
  }

  .overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid #252540;
    flex-shrink: 0;
  }

  .overlay-panel.sheet .overlay-header {
    padding-top: 8px;
  }

  .overlay-title {
    font-size: 13px;
    font-weight: 700;
    color: #d0d0f0;
    letter-spacing: 0.02em;
  }

  .overlay-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #9090c0;
    cursor: pointer;
    transition: background 0.12s;
  }

  .overlay-close:hover {
    background: #252545;
    color: #d0d0f0;
  }

  .overlay-body {
    flex: 1;
    overflow-y: auto;
  }
</style>
