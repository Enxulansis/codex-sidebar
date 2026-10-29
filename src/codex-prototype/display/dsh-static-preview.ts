/** DSH 0.1.165 (70b79fa), webview.ts:7193–7410, 7494–7526, 10886–10949.
 * Static preview geometry, gestures and controls retain the original implementation.
 * Only mounting/lifetime is adapted; no protocol, filesystem or host access here. */
const PREVIEW_MIN = 0.01, PREVIEW_MAX = 32, PREVIEW_KEEP_VISIBLE = 24;
export type PreviewLimits = {minScale?: number; maxScale?: number};
export function mountDshStaticPreview(requestClose: (rightClick?: boolean) => void, settings: () => PreviewLimits | undefined = () => undefined, stepImage?: (delta:number)=>void) {
  const overlay = document.createElement('div'); overlay.className = 'image-preview hidden'; overlay.hidden = true;
  overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-label','图片预览');
  const canvas = document.createElement('canvas'); canvas.className = 'image-preview-canvas'; canvas.draggable = false;
  const bar = document.createElement('div'); bar.className = 'preview-bar';
  const hint = document.createElement('div'); hint.className = 'image-preview-hint';
  const hintText = document.createElement('span');hintText.className='preview-hint-text'; hintText.textContent = '左键拖动 · 滚轮缩放 · 右键/ESC 退出';
  const zoomValue = document.createElement('span');
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'preview-action'; reset.textContent = '⟲';
  reset.title = '复位（居中并适应窗口）'; reset.setAttribute('aria-label','复位'); reset.dataset.previewReset = '';
  hint.append(hintText,zoomValue,reset); bar.append(hint); overlay.append(canvas,bar); document.body.append(overlay);
  let previewImage: HTMLImageElement|HTMLCanvasElement | undefined;
  let previewScale = 1, previewTarget = 1, previewFit = 1;
  let previewX = 0, previewY = 0, previewTargetX = 0, previewTargetY = 0;
  let previewPan = false, previewLastX = 0, previewLastY = 0, pointerId: number | undefined;
  let previewLoop: number | undefined, previewLastFrame = 0;
  let previewContextActive = false, previewContextSwipeOnce = false, previewContextTimer: number | undefined;
  const previewImageWidth = () => previewImage ? ('naturalWidth' in previewImage?previewImage.naturalWidth:previewImage.width) : 0;
  const previewImageHeight = () => previewImage ? ('naturalHeight' in previewImage?previewImage.naturalHeight:previewImage.height) : 0;
  function previewDraw() {
    const image = previewImage, imageWidth = previewImageWidth(), imageHeight = previewImageHeight();
    if (!image || imageWidth <= 0) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth, ch = canvas.clientHeight;
    const bw = Math.max(1,Math.round(cw*dpr)), bh = Math.max(1,Math.round(ch*dpr));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,cw,ch);
    const s = previewScale, srcW = cw/s, srcH = ch/s;
    const srcX = imageWidth/2-(cw/2+previewX)/s, srcY = imageHeight/2-(ch/2+previewY)/s;
    ctx.imageSmoothingEnabled = s <= 1.001;
    const clampV = (v:number,lo:number,hi:number) => Math.max(lo,Math.min(hi,v));
    const sx0 = clampV(srcX,0,imageWidth), sy0 = clampV(srcY,0,imageHeight);
    const sx1 = clampV(srcX+srcW,0,imageWidth), sy1 = clampV(srcY+srcH,0,imageHeight);
    const sw = sx1-sx0, sh = sy1-sy0;
    if (sw > 0 && sh > 0) {
      const dx = Math.round((sx0-srcX)*s*dpr)/dpr, dy = Math.round((sy0-srcY)*s*dpr)/dpr;
      ctx.drawImage(image,sx0,sy0,sw,sh,dx,dy,sw*s,sh*s);
    }
    const label = previewScale >= 10 ? previewScale.toFixed(1) : previewScale.toFixed(2);
    zoomValue.textContent = '  ·  ×'+label+' (1px='+label+'px)';
    // Existing display-only probes; never used as RPC/approval identity.
    overlay.dataset.scale = String(previewScale);
    overlay.dataset.x = String(previewX); overlay.dataset.y = String(previewY);
    overlay.dataset.target = String(previewTarget);
  }
  function previewLooper(ts:number) {
    previewLoop = undefined;
    const frame = ts === undefined ? performance.now() : ts;
    const dt = Math.min(0.08,Math.max(0.001,(frame-(previewLastFrame||frame))/1000));
    previewLastFrame = frame; const t = 1-Math.exp(-dt*22);
    const scaleDiff = previewTarget-previewScale;
    if (scaleDiff < -0.0004 || scaleDiff > 0.0004) {
      previewScale += scaleDiff*t; previewX += (previewTargetX-previewX)*t; previewY += (previewTargetY-previewY)*t;
      if (Math.abs(previewTarget-previewScale) < 0.0004) { previewScale=previewTarget; previewX=previewTargetX; previewY=previewTargetY; }
      previewDraw(); previewLoop=window.requestAnimationFrame(previewLooper);
    } else {
      previewScale=previewTarget; previewX=previewTargetX; previewY=previewTargetY;
      previewLastFrame=0; previewDraw();
    }
  }
  function previewZoomFactor(event:WheelEvent) {
    const delta = event.deltaMode === 1 ? event.deltaY*20 : event.deltaY;
    const scaled = Math.max(-140,Math.min(140,delta)); return Math.exp(-scaled*0.0028);
  }
  function previewViewport() {
    if (canvas.clientWidth > 0 && canvas.clientHeight > 0) return {w:canvas.clientWidth,h:canvas.clientHeight};
    const rect=overlay.getBoundingClientRect(); return {w:rect.width,h:rect.height};
  }
  function previewMinScaleLimit() { const value=settings(); return value && typeof value.minScale==='number'?value.minScale:PREVIEW_MIN; }
  function previewMaxScaleLimit() { const value=settings(); return value && typeof value.maxScale==='number'?value.maxScale:PREVIEW_MAX; }
  function previewLayout() {
    if (!previewImage) return;
    const viewport=previewViewport(), height=bar.offsetHeight, reserve=height>0?height+24:64;
    previewFit=Math.min(viewport.w/previewImageWidth(),Math.max(1,viewport.h-reserve)/previewImageHeight(),1);
    previewFit=Math.max(previewMinScaleLimit(),Math.min(1,previewFit));
    previewScale=previewFit; previewTarget=previewFit; previewX=0; previewY=-reserve/2;
    previewTargetX=0; previewTargetY=-reserve/2; previewDraw();
  }
  function clampPreviewPan() {
    if (!previewImage) return;
    const viewport=previewViewport(), pw=previewImageWidth()*previewTarget, ph=previewImageHeight()*previewTarget;
    const limX=Math.max(PREVIEW_KEEP_VISIBLE/2,viewport.w/2+pw/2-PREVIEW_KEEP_VISIBLE);
    const limY=Math.max(PREVIEW_KEEP_VISIBLE/2,viewport.h/2+ph/2-PREVIEW_KEEP_VISIBLE);
    previewTargetX=Math.max(-limX,Math.min(limX,previewTargetX)); previewTargetY=Math.max(-limY,Math.min(limY,previewTargetY));
  }
  function stopPreviewContextBlock() {
    if (previewContextTimer !== undefined) { clearTimeout(previewContextTimer); previewContextTimer=undefined; }
    if (previewContextActive) { previewContextActive=false; document.removeEventListener('contextmenu',blockPreviewContextMenu,true); }
  }
  function blockPreviewContextMenu(event:MouseEvent) {
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    if (previewContextSwipeOnce) { previewContextSwipeOnce=false; stopPreviewContextBlock(); }
  }
  function startPreviewContextBlock() {
    if (previewContextTimer !== undefined) { clearTimeout(previewContextTimer); previewContextTimer=undefined; }
    previewContextSwipeOnce=false;
    if (!previewContextActive) { previewContextActive=true; document.addEventListener('contextmenu',blockPreviewContextMenu,true); }
  }
  function endPreviewPan() {
    previewPan=false;
    if (pointerId !== undefined && overlay.hasPointerCapture(pointerId)) overlay.releasePointerCapture(pointerId);
    pointerId=undefined;
  }
  overlay.addEventListener('pointerdown',event=>{
    if (event.button===0) { previewPan=true; previewLastX=event.clientX; previewLastY=event.clientY; pointerId=event.pointerId; overlay.setPointerCapture(event.pointerId); }
    else if(event.button===2) requestClose(true);
  });
  overlay.addEventListener('pointermove',event=>{
    if (!previewPan) return;
    previewX+=event.clientX-previewLastX; previewY+=event.clientY-previewLastY;
    previewTargetX=previewX; previewTargetY=previewY; clampPreviewPan(); previewX=previewTargetX; previewY=previewTargetY;
    previewLastX=event.clientX; previewLastY=event.clientY; previewDraw();
  });
  overlay.addEventListener('pointerup',endPreviewPan); overlay.addEventListener('pointercancel',endPreviewPan);
  overlay.addEventListener('wheel',event=>{
    event.preventDefault(); if (!previewImage) return;
    const rect=overlay.getBoundingClientRect(),viewport=previewViewport();
    const cursorX=event.clientX-rect.left,cursorY=event.clientY-rect.top,centerX=viewport.w/2,centerY=viewport.h/2;
    const next=Math.max(previewMinScaleLimit(),Math.min(previewMaxScaleLimit(),previewTarget*previewZoomFactor(event)));
    const halfW=previewImageWidth()*previewTarget/2,halfH=previewImageHeight()*previewTarget/2;
    const onImage=cursorX>=centerX+previewTargetX-halfW&&cursorX<=centerX+previewTargetX+halfW&&cursorY>=centerY+previewTargetY-halfH&&cursorY<=centerY+previewTargetY+halfH;
    const anchorX=onImage?cursorX:centerX+previewTargetX,anchorY=onImage?cursorY:centerY+previewTargetY;
    const localX=(anchorX-centerX-previewTargetX)/previewTarget,localY=(anchorY-centerY-previewTargetY)/previewTarget;
    previewTargetX=anchorX-centerX-localX*next; previewTargetY=anchorY-centerY-localY*next; previewTarget=next; clampPreviewPan();
    if (previewLoop===undefined) previewLoop=window.requestAnimationFrame(previewLooper);
  },{passive:false});
  overlay.addEventListener('contextmenu',event=>event.preventDefault());
  bar.addEventListener('pointerdown',event=>event.stopPropagation());
  reset.addEventListener('pointerdown',event=>event.stopPropagation());
  reset.addEventListener('click',event=>{event.stopPropagation(); if (!overlay.hidden) previewLayout();});
  window.addEventListener('keydown',event=>{if(overlay.hidden)return;if(event.key==='Escape'){event.preventDefault();requestClose();}else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();stepImage?.(event.key==='ArrowLeft'?-1:1);}});
  window.addEventListener('resize',()=>{if (!overlay.hidden) previewDraw();});
  return {
    overlay,
    galleryPosition(index:number,total:number){
      const parts=['左键拖动','滚轮缩放','右键/ESC 退出'];
      if(total>1)parts.push('←/→ 切换图片（'+String(index+1)+'/'+String(total)+'）');
      hintText.textContent=parts.join(' · ');
      overlay.dataset.galleryIndex=String(index);overlay.dataset.galleryCount=String(total);
      overlay.dataset.galleryMultiple=String(total>1);
    },
    applyLimits(){
      if(!previewImage||overlay.hidden)return;
      const min=previewMinScaleLimit(),max=previewMaxScaleLimit(),scale=Math.max(min,Math.min(max,previewScale)),target=Math.max(min,Math.min(max,previewTarget));
      if(scale===previewScale&&target===previewTarget)return;
      previewScale=scale;previewTarget=target;previewTargetX=previewX;previewTargetY=previewY;clampPreviewPan();previewX=previewTargetX;previewY=previewTargetY;previewDraw();
    },
    show(image:HTMLImageElement|HTMLCanvasElement,layout=true) { if(!layout){previewImage=image;previewDraw();return;}if(previewLoop!==undefined){window.cancelAnimationFrame(previewLoop);previewLoop=undefined;}endPreviewPan();previewImage=image; overlay.hidden=false; overlay.classList.remove('hidden'); previewLayout(); startPreviewContextBlock(); },
    close(rightClick?:boolean) {
      if (!overlay.hidden) {
        startPreviewContextBlock(); previewContextSwipeOnce=rightClick===true;
        previewContextTimer=window.setTimeout(stopPreviewContextBlock,rightClick===true?1500:260);
      }
      if (previewLoop!==undefined) { window.cancelAnimationFrame(previewLoop); previewLoop=undefined; }
      endPreviewPan(); overlay.hidden=true; overlay.classList.add('hidden'); previewImage=undefined;
      canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);
      previewScale=previewTarget=1; previewX=previewY=previewTargetX=previewTargetY=0; previewLastFrame=0;
    },
  };
}
