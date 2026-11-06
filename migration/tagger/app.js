(function () {
    'use strict';

    var CATS = ['people', 'travel', 'series'];
    var CAT_LABEL = { people: 'People', travel: 'Travel', series: 'Series' };
    var ROW_H = 150;

    var posts = [], config = {}, photos = {}, reviewed = {};
    var rev = null, stale = false;
    var postById = {};
    var sel = new Set();          // "postId|photoKey"
    var anchor = null;
    var currentPost = null;
    var order = [];               // visible tile ids, in on-screen order
    var tileEls = new Map();
    var postEls = new Map();
    var undoStack = [];
    var slots = load('tagger-slots', []);      // shortcut keys 1–9 → tag
    var lastUsed = load('tagger-last', {});

    var sheet = $('sheet');

    function $(id) { return document.getElementById(id); }
    function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function split(id) { var i = id.indexOf('|'); return [id.slice(0, i), id.slice(i + 1)]; }

    /* ── Tag model ────────────────────────────────────────── */
    function catOf(tag) {
        if (CATS.indexOf(tag) > -1) return tag;
        for (var i = 0; i < CATS.length; i++) {
            if ((config[CATS[i]] || []).some(function (e) { return e.tag === tag; })) return CATS[i];
        }
        return null;
    }
    function labelOf(tag) {
        if (CAT_LABEL[tag]) return CAT_LABEL[tag];
        for (var i = 0; i < CATS.length; i++) {
            var hit = (config[CATS[i]] || []).filter(function (e) { return e.tag === tag; })[0];
            if (hit) return hit.label;
        }
        return tag;
    }
    function tagsOf(pid, key) { return (photos[pid] && photos[pid][key]) || []; }
    function setTags(pid, key, tags) {
        photos[pid] = photos[pid] || {};   // keep empty objects: they mark posts you've touched
        if (tags.length) photos[pid][key] = tags.slice().sort();
        else delete photos[pid][key];
    }
    function postTagSet(pid) {
        var s = new Set();
        var m = photos[pid] || {};
        Object.keys(m).forEach(function (k) { m[k].forEach(function (t) { s.add(t); }); });
        return s;
    }

    /* ── Rendering ────────────────────────────────────────── */
    function renderSheet() {
        sheet.textContent = '';
        posts.forEach(function (p) {
            var sec = el('section', 'post');
            sec.dataset.id = p.id;

            var head = el('div', 'post__head');
            head.appendChild(el('span', 'post__date', new Date(p.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })));
            var link = el('a', 'post__link', 'open ↗');
            link.href = p.url; link.target = '_blank'; link.rel = 'noopener';
            head.appendChild(link);
            if (p.tags.length) head.appendChild(el('span', 'post__tags', p.tags.map(function (t) { return '#' + t; }).join(' ')));
            head.appendChild(el('span', 'post__count'));
            var selBtn = el('button', 'post__btn js-select-post', 'Select all');
            selBtn.type = 'button';
            head.appendChild(selBtn);
            var revBtn = el('button', 'post__btn js-review', 'Reviewed');
            revBtn.type = 'button';
            head.appendChild(revBtn);
            sec.appendChild(head);

            var wrap = el('div', 'photos');
            p.photos.forEach(function (ph) {
                var id = p.id + '|' + ph.key;
                var t = el('div', 'photo');
                t.dataset.id = id;
                var r = ph.w && ph.h ? ph.w / ph.h : 1.5;
                t.style.width = Math.round(ROW_H * r) + 'px';
                var img = el('img');
                img.loading = 'lazy';
                img.decoding = 'async';
                img.src = ph.thumb;
                img.alt = '';
                t.appendChild(img);
                t.appendChild(el('div', 'photo__tags'));
                wrap.appendChild(t);
                tileEls.set(id, t);
                paintTile(id);
            });
            sec.appendChild(wrap);
            sheet.appendChild(sec);
            postEls.set(p.id, sec);
            paintPost(p.id);
        });
    }

    function paintTile(id) {
        var t = tileEls.get(id);
        if (!t) return;
        var pk = split(id);
        t.classList.toggle('is-selected', sel.has(id));
        var box = t.lastChild;
        box.textContent = '';
        tagsOf(pk[0], pk[1]).forEach(function (tag) {
            box.appendChild(el('span', 'photo__tag photo__tag--' + (catOf(tag) || 'other'), labelOf(tag)));
        });
    }

    function paintPost(pid) {
        var sec = postEls.get(pid);
        var p = postById[pid];
        var m = photos[pid] || {};
        var tagged = p.photos.filter(function (ph) { return (m[ph.key] || []).length; }).length;
        sec.querySelector('.post__count').textContent = tagged + ' / ' + p.photos.length + ' tagged';
        sec.classList.toggle('is-reviewed', !!reviewed[pid]);
        sec.querySelector('.js-review').classList.toggle('is-on', !!reviewed[pid]);
        sec.querySelector('.js-review').textContent = reviewed[pid] ? '✓ Reviewed' : 'Reviewed';
        sec.classList.toggle('is-current', pid === currentPost);
    }

    function renderGroups() {
        var box = $('groups');
        box.textContent = '';
        CATS.forEach(function (cat) {
            var g = el('div', 'group');
            var head = el('div', 'group__head');
            head.appendChild(el('span', 'group__title', CAT_LABEL[cat]));
            var add = el('button', 'group__add', '+ Add');
            add.type = 'button';
            add.dataset.cat = cat;
            head.appendChild(add);
            g.appendChild(head);
            var chips = el('div', 'chips');
            var any = el('button', 'chip chip--cat', cat === 'people' ? 'Someone else' : 'Other ' + cat);
            any.type = 'button';
            any.dataset.tag = cat;
            any.title = 'Tag as "' + cat + '" without a specific ' + (cat === 'people' ? 'person' : 'entry');
            chips.appendChild(any);
            (config[cat] || []).slice().sort(function (x, y) {
                return x.label.localeCompare(y.label, undefined, { sensitivity: 'base' });
            }).forEach(function (e) {
                var c = el('button', 'chip', e.label);
                c.type = 'button';
                c.dataset.tag = e.tag;
                chips.appendChild(c);
            });
            g.appendChild(chips);
            box.appendChild(g);
        });
        paintChips();
        renderTagFilter();
    }

    function paintChips() {
        var items = Array.from(sel).map(split);
        document.querySelectorAll('.chip').forEach(function (c) {
            var tag = c.dataset.tag;
            var n = items.filter(function (pk) { return tagsOf(pk[0], pk[1]).indexOf(tag) > -1; }).length;
            c.classList.toggle('is-all', items.length > 0 && n === items.length);
            c.classList.toggle('is-some', n > 0 && n < items.length);
            c.disabled = !items.length;
            var old = c.querySelector('.chip__key');
            if (old) old.remove();
            var slot = slots.indexOf(tag);
            if (slot > -1) c.appendChild(el('span', 'chip__key', String(slot + 1)));
        });
        $('sel-count').textContent = sel.size ? sel.size + ' photo' + (sel.size === 1 ? '' : 's') + ' selected' : 'Nothing selected';
    }

    function paintProgress() {
        var total = 0, tagged = 0;
        posts.forEach(function (p) {
            var m = photos[p.id] || {};
            total += p.photos.length;
            p.photos.forEach(function (ph) { if ((m[ph.key] || []).length) tagged++; });
        });
        var done = posts.filter(function (p) { return reviewed[p.id]; }).length;
        $('progress-fill').style.width = (posts.length ? 100 * done / posts.length : 0) + '%';
        $('progress-text').textContent = done + ' / ' + posts.length + ' posts reviewed · ' + tagged + ' / ' + total + ' photos tagged';
    }

    function renderTagFilter() {
        var s = $('f-tag');
        var v = s.value;
        s.textContent = '';
        s.appendChild(new Option('Any', ''));
        CATS.forEach(function (cat) {
            var og = document.createElement('optgroup');
            og.label = CAT_LABEL[cat];
            og.appendChild(new Option('All ' + cat, cat));
            (config[cat] || []).forEach(function (e) { og.appendChild(new Option(e.label, e.tag)); });
            s.appendChild(og);
        });
        s.value = v;
    }

    function renderYearFilter() {
        var years = Array.from(new Set(posts.map(function (p) { return p.date.slice(0, 4); }))).sort().reverse();
        years.forEach(function (y) { $('f-year').appendChild(new Option(y, y)); });
    }

    /* ── Filters ──────────────────────────────────────────── */
    function postMatches(p) {
        var status = $('f-status').value, tag = $('f-tag').value, year = $('f-year').value;
        if (year && p.date.slice(0, 4) !== year) return false;
        if (status === 'reviewed' && !reviewed[p.id]) return false;
        if (status === 'unreviewed' && reviewed[p.id]) return false;
        if (status === 'untagged') {
            var m = photos[p.id] || {};
            if (!p.photos.some(function (ph) { return !(m[ph.key] || []).length; })) return false;
        }
        if (tag) {
            var tags = postTagSet(p.id);
            var hit = Array.from(tags).some(function (t) { return t === tag || (CATS.indexOf(tag) > -1 && catOf(t) === tag); });
            if (!hit) return false;
        }
        return true;
    }
    function applyFilters() {
        order = [];
        posts.forEach(function (p) {
            var show = postMatches(p);
            postEls.get(p.id).hidden = !show;
            if (show) p.photos.forEach(function (ph) { order.push(p.id + '|' + ph.key); });
        });
        var visible = new Set(order);
        Array.from(sel).forEach(function (id) { if (!visible.has(id)) { sel.delete(id); paintTile(id); } });
        paintChips();
    }
    ['f-status', 'f-tag', 'f-year'].forEach(function (id) { $(id).addEventListener('change', applyFilters); });

    /* ── Selection ────────────────────────────────────────── */
    function setSelection(ids, keepExisting) {
        var before = new Set(sel);
        if (!keepExisting) sel.clear();
        ids.forEach(function (id) { sel.add(id); });
        before.forEach(function (id) { if (!sel.has(id)) paintTile(id); });
        sel.forEach(function (id) { if (!before.has(id)) paintTile(id); });
        paintChips();
    }
    function clearSelection() { setSelection([], false); anchor = null; }

    function clickTile(id, e) {
        if (e.shiftKey && anchor && order.indexOf(anchor) > -1) {
            var a = order.indexOf(anchor), b = order.indexOf(id);
            setSelection(order.slice(Math.min(a, b), Math.max(a, b) + 1), e.metaKey || e.ctrlKey);
        } else if (e.metaKey || e.ctrlKey) {
            if (sel.has(id)) { sel.delete(id); paintTile(id); paintChips(); }
            else setSelection([id], true);
            anchor = id;
        } else {
            setSelection([id], false);
            anchor = id;
        }
        setCurrent(split(id)[0]);
    }

    function selectPost(pid) {
        var p = postById[pid];
        if (!p) return;
        setSelection(p.photos.map(function (ph) { return pid + '|' + ph.key; }), false);
        anchor = pid + '|' + p.photos[0].key;
        setCurrent(pid);
    }

    // Box (lasso) selection
    var lasso = $('lasso'), drag = null;
    sheet.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        var tile = e.target.closest('.photo');
        if (tile) { e.preventDefault(); clickTile(tile.dataset.id, e); return; }
        if (e.target.closest('button, a')) return;
        e.preventDefault();
        drag = { x: e.clientX, y: e.clientY, keep: e.shiftKey || e.metaKey || e.ctrlKey, base: new Set(sel), moved: false };
    });
    window.addEventListener('mousemove', function (e) {
        if (!drag) return;
        var x1 = Math.min(drag.x, e.clientX), x2 = Math.max(drag.x, e.clientX);
        var y1 = Math.min(drag.y, e.clientY), y2 = Math.max(drag.y, e.clientY);
        if (!drag.moved && x2 - x1 < 4 && y2 - y1 < 4) return;
        drag.moved = true;
        lasso.hidden = false;
        lasso.style.left = x1 + 'px'; lasso.style.top = y1 + 'px';
        lasso.style.width = (x2 - x1) + 'px'; lasso.style.height = (y2 - y1) + 'px';
        var hits = drag.keep ? Array.from(drag.base) : [];
        postEls.forEach(function (sec) {
            if (sec.hidden) return;
            var r = sec.getBoundingClientRect();
            if (r.bottom < y1 || r.top > y2) return;
            sec.querySelectorAll('.photo').forEach(function (t) {
                var b = t.getBoundingClientRect();
                if (b.right >= x1 && b.left <= x2 && b.bottom >= y1 && b.top <= y2) hits.push(t.dataset.id);
            });
        });
        setSelection(hits, false);
    });
    window.addEventListener('mouseup', function () {
        if (!drag) return;
        if (!drag.moved && !drag.keep) clearSelection();
        else if (sel.size) { anchor = Array.from(sel)[0]; setCurrent(split(anchor)[0]); }
        drag = null;
        lasso.hidden = true;
    });

    sheet.addEventListener('click', function (e) {
        var sec = e.target.closest('.post');
        if (!sec) return;
        if (e.target.closest('.js-select-post')) selectPost(sec.dataset.id);
        if (e.target.closest('.js-review')) toggleReviewed(sec.dataset.id, false);
    });

    /* ── Current post / navigation ────────────────────────── */
    function setCurrent(pid) {
        if (pid === currentPost) return;
        var prev = currentPost;
        currentPost = pid;
        if (prev && postEls.has(prev)) paintPost(prev);
        if (pid && postEls.has(pid)) paintPost(pid);
    }
    function visiblePosts() { return posts.filter(function (p) { return !postEls.get(p.id).hidden; }); }
    var navLock = 0;
    function goTo(pid) {
        if (!pid) return;
        navLock = Date.now();
        setCurrent(pid);
        postEls.get(pid).scrollIntoView({ block: 'start' });
    }
    function step(d) {
        var v = visiblePosts();
        var i = v.findIndex(function (p) { return p.id === currentPost; });
        var n = v[Math.max(0, Math.min(v.length - 1, i + d))];
        if (n) { clearSelection(); goTo(n.id); }
    }
    function nextUnreviewed() {
        var v = visiblePosts();
        var i = v.findIndex(function (p) { return p.id === currentPost; });
        var rest = v.slice(i + 1).concat(v.slice(0, i + 1));
        var n = rest.filter(function (p) { return !reviewed[p.id]; })[0];
        if (n) { clearSelection(); goTo(n.id); } else toast('Every visible post is reviewed 🎉');
    }
    sheet.addEventListener('scroll', function () {
        if (sel.size || Date.now() - navLock < 500) return;
        var top = sheet.getBoundingClientRect().top + 60;
        var v = visiblePosts();
        for (var i = 0; i < v.length; i++) {
            if (postEls.get(v[i].id).getBoundingClientRect().bottom > top) { setCurrent(v[i].id); break; }
        }
    }, { passive: true });

    /* ── Editing ──────────────────────────────────────────── */
    function snapshot(ids) {
        undoStack.push(ids.map(function (id) { var pk = split(id); return [pk[0], pk[1], tagsOf(pk[0], pk[1]).slice()]; }));
        if (undoStack.length > 200) undoStack.shift();
    }
    function afterEdit(ids) {
        var pids = new Set();
        ids.forEach(function (id) { paintTile(id); pids.add(split(id)[0]); });
        pids.forEach(paintPost);
        paintChips();
        paintProgress();
        save();
    }
    function bumpSlot(tag) {
        lastUsed[tag] = Date.now();
        if (slots.indexOf(tag) === -1) {
            if (slots.length < 9) slots.push(tag);
            else {
                var oldest = 0;
                slots.forEach(function (t, i) { if ((lastUsed[t] || 0) < (lastUsed[slots[oldest]] || 0)) oldest = i; });
                slots[oldest] = tag;
            }
        }
        localStorage.setItem('tagger-slots', JSON.stringify(slots));
        localStorage.setItem('tagger-last', JSON.stringify(lastUsed));
    }
    function toggleTag(tag) {
        if (!sel.size) { toast('Select photos first'); return; }
        var ids = Array.from(sel);
        var all = ids.every(function (id) { var pk = split(id); return tagsOf(pk[0], pk[1]).indexOf(tag) > -1; });
        snapshot(ids);
        ids.forEach(function (id) {
            var pk = split(id);
            var t = tagsOf(pk[0], pk[1]).filter(function (x) { return x !== tag; });
            if (!all) t.push(tag);
            setTags(pk[0], pk[1], t);
        });
        bumpSlot(tag);
        afterEdit(ids);
    }
    function clearTags() {
        if (!sel.size) return;
        var ids = Array.from(sel);
        snapshot(ids);
        ids.forEach(function (id) { var pk = split(id); setTags(pk[0], pk[1], []); });
        afterEdit(ids);
    }
    function undo() {
        var snap = undoStack.pop();
        if (!snap) { toast('Nothing to undo'); return; }
        snap.forEach(function (s) { setTags(s[0], s[1], s[2]); });
        afterEdit(snap.map(function (s) { return s[0] + '|' + s[1]; }));
    }
    function toggleReviewed(pid, advance) {
        if (!pid) return;
        if (reviewed[pid]) delete reviewed[pid]; else reviewed[pid] = true;
        paintPost(pid);
        paintProgress();
        save();
        if (advance && reviewed[pid]) nextUnreviewed();
    }

    $('groups').addEventListener('click', function (e) {
        var chip = e.target.closest('.chip');
        if (chip) { toggleTag(chip.dataset.tag); return; }
        var add = e.target.closest('.group__add');
        if (add) addEntry(add.dataset.cat);
    });
    $('btn-select-post').addEventListener('click', function () { selectPost(currentPost); });
    $('btn-clear-tags').addEventListener('click', clearTags);
    $('btn-undo').addEventListener('click', undo);

    // Inline input instead of prompt(): embedded browsers often block dialogs.
    function addEntry(cat) {
        var group = document.querySelector('.group__add[data-cat="' + cat + '"]').closest('.group');
        var existing = group.querySelector('.add-form');
        if (existing) { existing.querySelector('input').focus(); return; }
        var form = el('form', 'add-form');
        var input = el('input');
        input.type = 'text';
        input.placeholder = 'New ' + (cat === 'people' ? 'person' : cat === 'travel' ? 'location' : 'series') + ' name';
        var ok = el('button', null, 'Add');
        ok.type = 'submit';
        var cancel = el('button', null, 'Cancel');
        cancel.type = 'button';
        form.appendChild(input);
        form.appendChild(ok);
        form.appendChild(cancel);
        group.querySelector('.group__head').after(form);
        input.focus();
        cancel.addEventListener('click', function () { form.remove(); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); form.remove(); } });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (input.value.trim()) submitEntry(cat, input.value);
        });
    }

    function submitEntry(cat, label) {
        fetch('/api/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ category: cat, label: label })
        }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error); return j; }); })
          .then(function (j) {
              config = j.config;
              renderGroups();
              toast('Added "' + label.trim() + '" (tag: ' + j.tag + ') to the theme');
              if (sel.size) toggleTag(j.tag);
          })
          .catch(function (err) { toast(err.message); });
    }

    /* ── Keyboard ─────────────────────────────────────────── */
    document.addEventListener('keydown', function (e) {
        if (e.target.closest('input, select, textarea')) return;
        var k = e.key.toLowerCase();
        if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); undo(); return; }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (k === 'escape') clearSelection();
        else if (k === 'a') selectPost(currentPost);
        else if (k === 'r') toggleReviewed(currentPost, true);
        else if (k === 'j') step(1);
        else if (k === 'k') step(-1);
        else if (k === 'u') nextUnreviewed();
        else if (k === 'backspace' || k === 'delete') clearTags();
        else if (/^[1-9]$/.test(k)) { if (slots[+k - 1]) toggleTag(slots[+k - 1]); }
        else return;
        e.preventDefault();
    });

    /* ── Persistence ──────────────────────────────────────── */
    var saveTimer = null, dirty = false;
    function save() {
        if (stale) { showStale(); return; }
        dirty = true;
        $('save-status').textContent = 'Saving…';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 400);
    }
    function flush() {
        fetch('/api/state', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ photos: photos, reviewed: reviewed, rev: rev })
        }).then(function (r) {
            if (r.status === 409) { stale = true; dirty = false; showStale(); return; }
            if (!r.ok) throw new Error(r.status);
            return r.json().then(function (j) {
                rev = j.rev;
                dirty = false;
                $('save-status').textContent = 'Saved ' + new Date().toLocaleTimeString();
            });
        }).catch(function () {
            $('save-status').textContent = '⚠ Not saved — is the tagger server running?';
        });
    }
    window.addEventListener('beforeunload', function (e) { if (dirty) { flush(); e.preventDefault(); } });

    function showStale() {
        $('save-status').textContent = '⚠ Out of date — reload this page. Changes here are not saved.';
        $('save-status').style.color = '#c00';
        toast('This page is out of date — reload to keep tagging');
    }

    var toastTimer;
    function toast(msg) {
        var t = $('toast');
        t.textContent = msg;
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
    }

    /* ── Boot ─────────────────────────────────────────────── */
    fetch('/api/state').then(function (r) { return r.json(); }).then(function (d) {
        posts = d.posts;
        config = d.config;
        slots = slots.filter(function (t) { return !!catOf(t); });   // drop renamed/removed tags
        photos = d.state.photos;
        reviewed = d.state.reviewed;
        rev = d.rev;
        posts.forEach(function (p) { postById[p.id] = p; });
        renderGroups();
        renderYearFilter();
        renderSheet();
        applyFilters();
        paintProgress();
        if (posts.length) setCurrent(posts[0].id);
        $('save-status').textContent = 'Export: ' + d.source + ', ' + new Date(d.exportedAt).toLocaleString();
    });
})();
