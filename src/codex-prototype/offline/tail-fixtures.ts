import type{TailMeta}from'../page-model';
/** Synthetic display clock captured while preparing this fixture; it is not conversation history. */
const DEMO_CLOCK_MS=1791902712007;
export function syntheticTailMeta(index:number,assistant=true):TailMeta{
 const timeMs=DEMO_CLOCK_MS-index*120_000;
 if(!assistant)return{source:'synthetic',timeMs,timeSource:'synthetic'};
 const last={totalTokens:12100,inputTokens:10000,cachedInputTokens:7000,cacheWriteInputTokens:500,outputTokens:2100,reasoningOutputTokens:700};
 return{source:'synthetic',timeMs,timeSource:'synthetic',durationMs:42_000,durationSource:'synthetic',firstVisibleMs:2200,averageOutputTokS:50,tokenUsage:{total:{...last,totalTokens:48400,inputTokens:40000,outputTokens:8400,cachedInputTokens:28000,cacheWriteInputTokens:2000,reasoningOutputTokens:2800},last,modelContextWindow:128000}};
}
