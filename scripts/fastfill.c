/* Tiny helpers for scripts/build_catalog.py (compiled automatically with gcc).
   flood:  4-connected fill of `mask` from seed pixels -> out (1 = reached)
   label:  4-connected component labelling of `mask` -> labels (0 = background), returns count */
#include <stdint.h>
#include <stdlib.h>

int flood(const uint8_t *mask, int w, int h, const int32_t *seeds, int nseeds, uint8_t *out) {
  int32_t *stack = (int32_t *)malloc(sizeof(int32_t) * (size_t)w * h);
  if (!stack) return -1;
  int sp = 0;
  for (int i = 0; i < nseeds; i++) {
    int s = seeds[i];
    if (s >= 0 && s < w * h && mask[s] && !out[s]) { out[s] = 1; stack[sp++] = s; }
  }
  while (sp) {
    int p = stack[--sp]; int x = p % w;
    int n;
    n = p - w; if (p >= w && mask[n] && !out[n]) { out[n] = 1; stack[sp++] = n; }
    n = p + w; if (p < w * (h - 1) && mask[n] && !out[n]) { out[n] = 1; stack[sp++] = n; }
    n = p - 1; if (x > 0 && mask[n] && !out[n]) { out[n] = 1; stack[sp++] = n; }
    n = p + 1; if (x < w - 1 && mask[n] && !out[n]) { out[n] = 1; stack[sp++] = n; }
  }
  free(stack);
  return 0;
}

int label(const uint8_t *mask, int w, int h, int32_t *labels) {
  int32_t *stack = (int32_t *)malloc(sizeof(int32_t) * (size_t)w * h);
  if (!stack) return -1;
  int count = 0;
  for (int s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    count++;
    int sp = 0; labels[s] = count; stack[sp++] = s;
    while (sp) {
      int p = stack[--sp]; int x = p % w; int n;
      n = p - w; if (p >= w && mask[n] && !labels[n]) { labels[n] = count; stack[sp++] = n; }
      n = p + w; if (p < w * (h - 1) && mask[n] && !labels[n]) { labels[n] = count; stack[sp++] = n; }
      n = p - 1; if (x > 0 && mask[n] && !labels[n]) { labels[n] = count; stack[sp++] = n; }
      n = p + 1; if (x < w - 1 && mask[n] && !labels[n]) { labels[n] = count; stack[sp++] = n; }
    }
  }
  free(stack);
  return count;
}
