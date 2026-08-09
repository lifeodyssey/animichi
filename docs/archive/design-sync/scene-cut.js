/* scene-cut.js — Animal-Crossing scene transition.
   A little fox trots in place on a loading screen, then a circular mask (--mask-r)
   expands 0 → finalR to wipe the cover away and reveal whatever is beneath — the
   same iris mechanic as the library's <Loading> component, restyled with the fox
   mascot. Sequence is timer-driven so teardown is guaranteed even when CSS
   animations are throttled in a non-compositing iframe.

   Usage:
     SceneCut.play({
       target,      // element to cover (needs position:relative + overflow:hidden);
                    //   omit for document.body (fixed, full-window)
       label,       // text under the fox (default 読み込み中)
       dark,        // true for the night palette
       foxSrc,      // fox art (default assets/fox/fox-trot.svg)
       holdMs,      // time fully covered before the iris opens (default 1300)
       irisDiv,     // iris px/sec (default 1100; library uses 1500)
       onCovered,   // fires once fully covered — swap the destination in here
       onDone       // fires after the iris finishes and the cover is removed
     });  -> overlay element
*/
(function () {
  if (window.SceneCut) return;

  var STYLE_ID = 'scenecut-style';
  if (!document.getElementById(STYLE_ID)) {
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '@property --mask-r{syntax:"<length>";inherits:false;initial-value:0px;}',
      '.scenecut{position:absolute;inset:0;z-index:9999;display:flex;flex-direction:column;',
      '  align-items:center;justify-content:center;gap:30px;opacity:0;transition:opacity .26s ease;',
      '  --sc-ink:#1c9b8e;--sc-trail:rgba(120,92,60,.30);',
      '  -webkit-mask:radial-gradient(circle at 50% 50%,transparent 0,transparent var(--mask-r,0px),#000 var(--mask-r,0px));',
      '          mask:radial-gradient(circle at 50% 50%,transparent 0,transparent var(--mask-r,0px),#000 var(--mask-r,0px));}',
      '.scenecut.fixed{position:fixed;}',
      '.scenecut.in{opacity:1;}',
      '.scenecut.sc-dark{--sc-ink:#9fe6dd;--sc-trail:rgba(255,255,255,.28);}',
      '.scenecut-stage{display:flex;flex-direction:column;align-items:center;gap:13px;}',
      '.scenecut-fox{width:132px;height:132px;display:block;filter:drop-shadow(0 9px 7px rgba(61,52,40,.30));}',
      '.scenecut-ground{width:148px;height:7px;border-radius:4px;',
      '  background:repeating-linear-gradient(90deg,var(--sc-trail) 0 9px,transparent 9px 20px);}',
      '.scenecut-label{font-family:"Zen Maru Gothic","Nunito","Noto Sans SC",sans-serif;font-weight:800;',
      '  font-size:17px;letter-spacing:.6px;display:flex;align-items:center;color:var(--sc-ink);}',
      '.scenecut-label .d{animation:scenecut-blink 1.2s infinite;}',
      '.scenecut-label .d:nth-child(2){animation-delay:.2s;}.scenecut-label .d:nth-child(3){animation-delay:.4s;}',
      '@keyframes scenecut-blink{0%,100%{opacity:.25;}50%{opacity:1;}}',
      '@media (prefers-reduced-motion:no-preference){',
      ' .scenecut-fox{animation:scenecut-hop .55s cubic-bezier(.45,0,.55,1) infinite;}',
      ' .scenecut-ground{animation:scenecut-trail .55s linear infinite;}}',
      '@keyframes scenecut-hop{0%,100%{transform:translateY(0) rotate(-1.5deg);}50%{transform:translateY(-13px) rotate(1.5deg);}}',
      '@keyframes scenecut-trail{to{background-position:-20px 0;}}'
    ].join('');
    document.head.appendChild(s);
  }

  function play(opts) {
    opts = opts || {};
    var target = opts.target || document.body;
    var fixed = !opts.target;
    var holdMs = opts.holdMs != null ? opts.holdMs : 1300;
    var irisDiv = opts.irisDiv != null ? opts.irisDiv : 1100;
    var label = opts.label != null ? opts.label : '読み込み中';
    var dark = !!opts.dark;
    var foxSrc = opts.foxSrc || 'assets/fox/fox-trot.svg';
    var bg = opts.bg || (dark
      ? 'radial-gradient(66% 54% at 50% 42%,#1c3340 0%,#142433 50%,#0d1622 100%)'
      : 'radial-gradient(66% 54% at 50% 42%,#fffdf5 0%,#f3eede 55%,#ece4d2 100%)');

    var ov = document.createElement('div');
    ov.className = 'scenecut' + (fixed ? ' fixed' : '') + (dark ? ' sc-dark' : '');
    ov.style.background = bg;
    ov.style.setProperty('--mask-r', '0px');
    ov.innerHTML = '<div class="scenecut-stage">'
      + '<img class="scenecut-fox" src="' + foxSrc + '" alt="">'
      + '<div class="scenecut-ground"></div>'
      + '</div>'
      + '<div class="scenecut-label">' + label + '<span class="d">.</span><span class="d">.</span><span class="d">.</span></div>';
    target.appendChild(ov);

    void ov.offsetWidth;
    requestAnimationFrame(function () { ov.classList.add('in'); });

    var rect = target.getBoundingClientRect();
    var finalR = Math.ceil(Math.hypot(rect.width || 360, rect.height || 760) / 2) + 50;
    var dur = Math.max(0.18, finalR / irisDiv);

    var t1 = setTimeout(function () { if (opts.onCovered) opts.onCovered(); }, 280);
    var t2 = setTimeout(function () {
      ov.style.setProperty('--mask-r', '0px');
      void ov.offsetHeight;
      ov.style.transition = '--mask-r ' + dur + 's linear, opacity .26s ease';
      ov.style.setProperty('--mask-r', finalR + 'px');
    }, 280 + holdMs);
    var t3 = setTimeout(function () {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      if (opts.onDone) opts.onDone();
    }, 280 + holdMs + dur * 1000 + 80);
    ov._timers = [t1, t2, t3];
    return ov;
  }

  window.SceneCut = { play: play };
})();
