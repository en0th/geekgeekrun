<script setup lang="ts">
defineProps<{ name: string }>();
const paths: Record<string, string> = {
  spark: "m12 3 2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1L12 3Z",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
  briefcase:
    "M4 7h16a1 1 0 0 1 1 1v12H3V8a1 1 0 0 1 1-1Zm4 0V4h8v3M3 12l9 4 9-4m-9 2v4",
  mail: "M4 5h16a1 1 0 0 1 1 1v13H3V6a1 1 0 0 1 1-1Zm-1 2 9 7 9-7",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  send: "m21 3-7 18-4-7-7-4L21 3Zm0 0L10 14",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  back: "m14 5-7 7 7 7",
  check: "m5 12 4 4L19 6",
  refresh: "M20 7v5h-5M4 17v-5h5m10-5a8 8 0 0 0-14-2m0 12a8 8 0 0 0 14 2",
  pin: "M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  settings:
    "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0-6v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
};
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.spark" />
  </svg>
</template>
