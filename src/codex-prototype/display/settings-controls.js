/** DSH 0.1.165 controls, source webview.ts:8866–9066 and 11727–11794.
 * Shared keyboard, accessible names and detached-control cleanup live here. */
import {normalizeHexColor,hexToRgb,rgbToHex,rgbToHsl,hslToRgb} from '../../color-utils.js';
let controlSequence=0;
export function createSettingsControls(){
function node(tag,cls,text){const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;}
    const CHEVRON_DOWN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>';
    const CHEVRON_UP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 15 6-6 6 6"/></svg>';
const observers=[];
    function settingsSection(title) {
      const section = node('div', 'settings-section');
      section.append(node('div', 'settings-section-title', title));
      return section;
    }
    function settingsRow(label, hint, control, warn) {
      /* 0.0.97（G42）：warn=true → 行说明红字（哨兵值 -1 = 刻意设置的特殊值）。 */
      const row = node('div', 'settings-row');
      const texts = node('div', 'settings-row-text');
      texts.append(node('div', 'settings-row-label', label));
      const description=node('div', 'settings-row-hint' + (warn === true ? ' settings-row-warn' : ''), hint);
      description.id='settings-hint-'+(++controlSequence);
      if (hint) texts.append(description);
      row.append(texts);
      if (control) {
        row.append(control);
        const fields=[...(control.matches('button,input,select')?[control]:[]),...control.querySelectorAll('button,input,select')];
        for(const field of fields){
          const detail=field.getAttribute('aria-label')||field.title||'';
          field.setAttribute('aria-label',label+(detail?' · '+detail:''));
          if(hint)field.setAttribute('aria-describedby',description.id);
        }
      }
      return row;
    }
    function settingsSwitch(current, onToggle) {
      const button = node('button', 'settings-switch' + (current === true ? ' on' : ''));
      button.type = 'button';
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-checked', current === true ? 'true' : 'false');
      button.append(node('span', 'settings-switch-knob'));
      button.addEventListener('click', () => {
        const next = button.getAttribute('aria-checked') !== 'true';
        button.setAttribute('aria-checked', next ? 'true' : 'false');
        button.classList.toggle('on', next);
        onToggle(next);
      });
      return button;
    }
    function settingsEnum(current, options, onPick) {
      const wrap = node('div', 'settings-enum');
      const select = document.createElement('select');
      for (const option of options) {
        const element = new Option(option[1], option[0], false, option[0] === current);
        /* 0.0.66（用户反馈）: 菜单项悬停显示原始值（翻译只在显示层，原始 key 始终可得）。 */
        element.title = String(option[0]);
        select.append(element);
      }
      wrap.append(select);
      installDrop(select, { down: true });
      select.addEventListener('change', () => onPick(select.value));
      return wrap;
    }
    /* G45（0.0.103）：公式复制颜色控件——「跟随主题」开关 + 常用色块 + RGB/HSL/Hex 三段联动输入 + 预览。
       仅 SVG 复制生效（行说明已注明）；HSL 即色相-饱和-亮度（与 HSI 定义差异见调研文档）。 */
    const COLOR_SWATCHES = ['#000000', '#ffffff', '#e5484d', '#f76b15', '#46a758', '#0090ff', '#8e4ec6', '#8b8d98'];
    function settingsColorPicker(current, onCommit) {
      const initial = typeof current === 'string' && /^#[0-9a-f]{6}$/i.test(current) ? current.toLowerCase() : undefined;
      let custom = initial !== undefined ? initial : '#000000';
      const wrap = node('div', 'settings-color');
      const head = node('div', 'settings-color-head');
      const body = node('div', 'settings-color-body');
      const toggle = settingsSwitch(initial === undefined, on => {
        body.classList.toggle('hidden', on);
        onCommit(on ? 'theme' : custom);
      });
      toggle.setAttribute('aria-label','跟随主题');
      head.append(node('span', 'settings-color-label', '跟随主题'), toggle);
      wrap.append(head, body);
      const mkInput = (value, min, max) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'settings-color-input';
        input.min = String(min); input.max = String(max); input.value = String(value);
        return input;
      };
      /* G45 v1.1（0.0.104）修复③：数字输入改自绘步进器——与设置台其他数字行同款样式
         （原生白色 spinner 在深色主题突兀）；步长 1，钳位到域。 */
      const mkStepperField = (value, min, max, commit) => {
        const stepper = node('span', 'settings-stepper');
        const input = mkInput(value, min, max);
        input.addEventListener('change', commit);
        const buttons = node('span', 'settings-stepper-buttons');
        const up = node('button', 'settings-step');
        up.type = 'button'; up.title = '增加'; up.setAttribute('aria-label', '增加'); up.innerHTML = CHEVRON_UP_SVG;
        const down = node('button', 'settings-step');
        down.type = 'button'; down.title = '减少'; down.setAttribute('aria-label', '减少'); down.innerHTML = CHEVRON_DOWN_SVG;
        const bump = (delta) => {
          const next = Math.min(max, Math.max(min, Math.round((Number(input.value) || 0) + delta)));
          input.value = String(next);
          commit();
        };
        up.addEventListener('click', () => bump(1));
        down.addEventListener('click', () => bump(-1));
        buttons.append(up, down);
        stepper.append(input, buttons);
        return { wrap: stepper, input };
      };
      const rgbFields = [mkStepperField(0, 0, 255, () => commitRgb()), mkStepperField(0, 0, 255, () => commitRgb()), mkStepperField(0, 0, 255, () => commitRgb())];
      const hslFields = [mkStepperField(0, 0, 360, () => commitHsl()), mkStepperField(0, 0, 100, () => commitHsl()), mkStepperField(0, 0, 100, () => commitHsl())];
      for(const [fields,names] of [[rgbFields,['红色 R','绿色 G','蓝色 B']],[hslFields,['色相 H','饱和度 S','亮度 L']]])fields.forEach((field,index)=>{
        field.input.setAttribute('aria-label',names[index]);
        for(const button of field.wrap.querySelectorAll('button'))button.setAttribute('aria-label',names[index]+' · '+button.title);
      });
      const hexInput = document.createElement('input');
      hexInput.type = 'text'; hexInput.className = 'settings-color-input settings-color-hex';
      hexInput.spellcheck = false; hexInput.maxLength = 7;
      hexInput.setAttribute('aria-label','Hex 颜色');
      /* G45 v1.1（0.0.104）修复②：可打开的系统调色盘——原生 color 输入，点击弹出取色器；
         拖动实时预览（input）、确定时提交（change）。 */
      const nativePicker = document.createElement('input');
      nativePicker.type = 'color';
      nativePicker.className = 'settings-color-native';
      nativePicker.title = '打开调色盘';
      nativePicker.value = custom;
      nativePicker.addEventListener('input', () => apply(nativePicker.value, false));
      nativePicker.addEventListener('change', () => apply(nativePicker.value, true));
      const preview = node('span', 'settings-color-preview');
      const fieldRow = (tag, inputs) => {
        const row = node('div', 'settings-color-fields');
        row.append(node('span', 'settings-color-tag', tag));
        for (const input of inputs) row.append(input);
        return row;
      };
      const swatches = node('div', 'settings-color-swatches');
      for (const hex of COLOR_SWATCHES) {
        const swatch = node('button', 'settings-swatch');
        swatch.type = 'button';
        swatch.title = hex;
        swatch.style.background = hex;
        swatch.addEventListener('click', () => apply(hex, true));
        swatches.append(swatch);
      }
      function syncFromHex(hex) {
        custom = hex;
        const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        rgbFields[0].input.value = String(rgb.r); rgbFields[1].input.value = String(rgb.g); rgbFields[2].input.value = String(rgb.b);
        hslFields[0].input.value = String(hsl.h); hslFields[1].input.value = String(hsl.s); hslFields[2].input.value = String(hsl.l);
        hexInput.value = hex;
        nativePicker.value = hex;
        preview.style.background = hex;
      }
      function apply(hex, commit) {
        syncFromHex(hex);
        if (commit === true) onCommit(hex);
      }
      /* commit* 为函数声明（提升）——供上面的步进器在点击时回调。 */
      function commitRgb() { apply(rgbToHex(Number(rgbFields[0].input.value) || 0, Number(rgbFields[1].input.value) || 0, Number(rgbFields[2].input.value) || 0), true); }
      function commitHsl() {
        const rgb = hslToRgb(Number(hslFields[0].input.value) || 0, Number(hslFields[1].input.value) || 0, Number(hslFields[2].input.value) || 0);
        apply(rgbToHex(rgb.r, rgb.g, rgb.b), true);
      }
      function commitHex() {
        const hex = normalizeHexColor(hexInput.value);
        if (hex !== undefined) apply(hex, true);
        else syncFromHex(custom);
      }
      hexInput.addEventListener('change', commitHex);
      /* G45 v1.1（0.0.104）修复②：调色盘入口带注明标签（与色块同尺寸同圆角）。 */
      swatches.append(node('span', 'settings-color-label settings-color-native-label', '调色盘'), nativePicker);
      body.append(swatches, fieldRow('RGB', rgbFields.map(f => f.wrap)), fieldRow('HSL', hslFields.map(f => f.wrap)), fieldRow('Hex', [hexInput, preview]));
      syncFromHex(custom);
      body.classList.toggle('hidden', initial === undefined);
      return wrap;
    }
    function settingsNumber(current, min, max, onCommit, step, norm) {
      /* G6 v2（0.0.64）: bounds 可选（dsh 字段的 min/max 来自 schema meta，可能缺省）。
         0.0.95（G38 批次 1）: 可选 step（默认按值域推导）；小数步长（0.1）用于折叠触发阈值。
         0.0.96（用户实测 bug 修复）: 未显式给步长且值域窄（<2）时按域宽 1/100 取"整齐"小数步长——
         此前固定 ±1 会被 min/max 夹紧成"跳端点"（如预览最小缩放 0.005–1：一点就 0.005↔1）。
         0.0.97（G42）: 可选 norm（提交前先过一遍，用于哨兵值 -1 这类"范围外特例"）。 */
      const hasMin = typeof min === 'number' && Number.isFinite(min);
      const hasMax = typeof max === 'number' && Number.isFinite(max);
      let stepValue = typeof step === 'number' && Number.isFinite(step) && step > 0 ? step : undefined;
      if (stepValue === undefined) {
        stepValue = 1;
        if (hasMin && hasMax && max - min > 0 && max - min < 2) {
          const raw = (max - min) / 100;
          const pow = Math.pow(10, Math.max(0, Math.min(6, Math.ceil(-Math.log10(raw)))));
          stepValue = Math.max(Math.pow(10, -6), Math.round(raw * pow) / pow);
        }
      }
      const stepDecimals = stepValue === 1 ? 0 : (String(stepValue).split('.')[1] || '').length;
      const wrap = node('span', 'settings-stepper');
      const input = document.createElement('input');
      input.type = 'number'; input.className = 'settings-number';
      input.value = String(current);
      if (hasMin) input.min = String(min);
      if (hasMax) input.max = String(max);
      if (stepValue !== 1) input.step = String(stepValue);
      function commitValue(raw) {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) { input.value = String(current); return; }
        let clamped = typeof norm === 'function' ? norm(parsed) : parsed;
        if (!Number.isFinite(clamped)) { input.value = String(current); return; }
        if (hasMin) clamped = Math.max(min, clamped);
        if (hasMax) clamped = Math.min(max, clamped);
        if (stepDecimals > 0) clamped = Number(clamped.toFixed(stepDecimals));
        input.value = String(clamped);
        onCommit(clamped);
      }
      input.addEventListener('change', () => commitValue(input.value));
      /* 0.0.63（用户反馈④）: 自绘步进（原生 spinner 白色突兀）；步长按 stepValue（默认 1）。 */
      const buttons = node('span', 'settings-stepper-buttons');
      const up = node('button', 'settings-step');
      up.type = 'button'; up.title = '增加'; up.setAttribute('aria-label', '增加');
      up.innerHTML = CHEVRON_UP_SVG;
      const down = node('button', 'settings-step');
      down.type = 'button'; down.title = '减少'; down.setAttribute('aria-label', '减少');
      down.innerHTML = CHEVRON_DOWN_SVG;
      up.addEventListener('click', () => commitValue(Number(input.value) + stepValue));
      down.addEventListener('click', () => commitValue(Number(input.value) - stepValue));
      buttons.append(up, down);
      wrap.append(input, buttons);
      return wrap;
    }
    let activeDrop;
    function closeOutsideDrop(event) {
      if (activeDrop !== undefined && !activeDrop.drop.contains(event.target)) activeDrop.close();
    }
    document.addEventListener('click', closeOutsideDrop);
    function installDrop(select, opts) {
      const drop = document.createElement('div'); drop.className = 'ds-drop';
      if (opts && opts.down) drop.classList.add('down');
      const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'ds-trigger';
      const label = document.createElement('span'); label.className = 'ds-label';
      const caret = document.createElement('span'); caret.className = 'ds-caret disclosure-caret'; caret.setAttribute('aria-hidden', 'true');
      const menu = document.createElement('div'); menu.className = 'ds-menu' + (opts && opts.down ? ' down' : ''); menu.hidden = true; menu.setAttribute('role', 'listbox');
      menu.id='settings-options-'+(++controlSequence);trigger.setAttribute('aria-controls',menu.id);
      trigger.append(label, caret); drop.append(trigger, menu);
      const dropParent = select.parentNode;
      if (dropParent) dropParent.insertBefore(drop, select);
      else queueMicrotask(() => { const later = select.parentNode; if (later) later.insertBefore(drop, select); });
      select.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-haspopup', 'listbox');
      function render() {
        const focused=menu.contains(document.activeElement)?document.activeElement?.dataset.value:undefined;
        trigger.disabled = select.disabled;
        const name=select.getAttribute('aria-label');
        if(name){trigger.setAttribute('aria-label',name);menu.setAttribute('aria-label',name);}
        if(select.hasAttribute('aria-describedby'))trigger.setAttribute('aria-describedby',select.getAttribute('aria-describedby'));
        const opt = select.selectedOptions[0];
        label.textContent = opt ? (opt.textContent || opt.value) : (select.value || '');
        menu.textContent = '';
        const walk = (container) => {
          for (const o of container.children) {
            if (o.tagName === 'OPTGROUP') {
              const gh = document.createElement('div'); gh.className = 'ds-group'; gh.textContent = o.label;
              menu.append(gh);
              walk(o);
            } else {
              const row = document.createElement('div');
              row.className = 'ds-option' + (o.selected ? ' selected' : '');
              row.setAttribute('role', 'option');
              row.tabIndex=-1;row.dataset.value=o.value;
              const disabled=o.disabled||container.disabled===true;
              row.setAttribute('aria-selected',String(o.selected));row.setAttribute('aria-disabled',String(disabled));
              if (o.title) row.title = o.title;
              const title = document.createElement('span'); title.className = 'ds-option-title'; title.textContent = o.textContent;
              row.append(title);
              row.addEventListener('click', () => { if (select.disabled || disabled) return; close(true);select.value = o.value; select.dispatchEvent(new Event('change')); });
              menu.append(row);
            }
          }
        };
        walk(select);
        if(select.disabled)close();
        else if(focused!==undefined&&!menu.hidden)[...menu.children].find(row=>row.dataset.value===focused&&row.getAttribute('aria-disabled')!=='true')?.focus({preventScroll:true});
      }
      function open() {
        if(select.disabled)return;
        if (activeDrop !== undefined) activeDrop.close();
        activeDrop = { drop, close };
        trigger.setAttribute('aria-expanded', 'true'); render(); menu.hidden = false;
        /* 0.0.109（G51）：打开后按视口钳制——①默认左对齐向右侧展开；②触右缘改右对齐（贴触发点）；
           ③右对齐仍出左缘（宽菜单+窄面板）则夹紧左缘到视口 6px（CSS max-width 保证夹紧后右侧必安全）。 */
        menu.classList.remove('align-right'); menu.style.left = '';
        if (menu.getBoundingClientRect().right > window.innerWidth - 6) {
          menu.classList.add('align-right');
          if (menu.getBoundingClientRect().left < 6) {
            menu.classList.remove('align-right');
            menu.style.left = Math.round(6 - drop.getBoundingClientRect().left) + 'px';
          }
        }
      }
      function close(restore=false) {
        trigger.setAttribute('aria-expanded', 'false'); menu.hidden = true;
        if (activeDrop !== undefined && activeDrop.drop === drop) activeDrop = undefined;
        if(restore&&trigger.isConnected&&!trigger.disabled)trigger.focus({preventScroll:true});
      }
      trigger.addEventListener('click', () => (menu.hidden ? open() : close()));
      drop.addEventListener('keydown',event=>{
        if(event.defaultPrevented||event.isComposing||select.disabled)return;
        if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopPropagation();close(true);return;}
        if(event.key==='Tab'){if(!menu.hidden)close(true);return;}
        if(!['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key))return;
        event.preventDefault();event.stopPropagation();
        const wasClosed=menu.hidden;if(wasClosed)open();
        const rows=[...menu.querySelectorAll('.ds-option[aria-disabled="false"]')];if(!rows.length)return;
        const index=rows.indexOf(document.activeElement);
        if(!wasClosed&&(event.key==='Enter'||event.key===' ')&&index>=0){rows[index].click();return;}
        const selected=rows.findIndex(row=>row.getAttribute('aria-selected')==='true');
        const next=event.key==='Home'?0:event.key==='End'?rows.length-1:index<0?selected>=0?selected:event.key==='ArrowUp'?rows.length-1:0:(index+(event.key==='ArrowUp'?-1:1)+rows.length)%rows.length;
        rows[next].focus({preventScroll:true});rows[next].scrollIntoView({block:'nearest'});
      });
      drop.addEventListener('focusout',event=>{if(event.relatedTarget instanceof Node&&drop.contains(event.relatedTarget))return;close();});
      select.addEventListener('change', render);
      const observer=new MutationObserver(render);observer.observe(select, { attributes: true, childList: true, subtree: true });observers.push(observer);
      render();
    }
return {settingsSection,settingsRow,settingsSwitch,settingsEnum,settingsColorPicker,settingsNumber,close:()=>activeDrop?.close(),dispose:()=>{activeDrop?.close();observers.forEach(o=>o.disconnect());document.removeEventListener('click',closeOutsideDrop);}};
}
