#!/usr/bin/env python3
# generate-docs.py — regenerates the /docs and /compare HTML pages on browsermcp.dev
# from their markdown sources in content/. The committed HTML under docs/ is BUILD OUTPUT:
# never hand-edit it — edit the markdown source (or this generator) and re-run:
#   python3 scripts/generate-docs.py
# Output is deterministic; a clean run leaves `git status` unchanged.
import re, html, os, json, datetime

REPO=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','docs')+os.sep  # site root (build output)
DRAFTS=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','content')+os.sep  # markdown sources
OG='https://browsermcp.dev/og-image.jpg'
PAGES=[
 ('browsermcp-docs-install-claude-code.md','Docs','Claude Code','/docs/install-claude-code'),
 ('browsermcp-docs-install-codex.md','Docs','Codex','/docs/install-codex'),
 ('browsermcp-docs-install-cursor.md','Docs','Cursor','/docs/install-cursor'),
 ('browsermcp-docs-install-vscode.md','Docs','VS Code','/docs/install-vscode'),
 ('browsermcp-docs-install-zcode.md','Docs','ZCode','/docs/install-zcode'),
 ('browsermcp-docs-what-is-browser-mcp.md','Docs','What is Browser MCP','/docs/what-is-browser-mcp'),
 ('browsermcp-docs-tools.md','Docs','Tools','/docs/tools'),
 ('browsermcp-compare-browsermcp-io.md','Compare','vs browsermcp.io','/compare/browsermcp-io'),
]

INSTALL=['/docs/install-claude-code','/docs/install-codex','/docs/install-cursor','/docs/install-vscode','/docs/install-zcode']
CTX={'/docs/what-is-browser-mcp':'The concept, architecture, and how it works',
 '/docs/tools':'Full reference for all 34 browser tools',
 '/compare/browsermcp-io':'How it differs from the similarly-named browsermcp.io',
 '/docs/install-claude-code':'Add Browser MCP to Claude Code','/docs/install-codex':'Add Browser MCP to OpenAI Codex',
 '/docs/install-cursor':'Add Browser MCP to Cursor','/docs/install-vscode':'Add Browser MCP to VS Code agent mode',
 '/docs/install-zcode':'Add Browser MCP to z.ai ZCode'}
def front_matter(md):
    # optional leading '---' block of 'key: value' lines; a future publish_date holds a page back until that date
    if md.startswith('---\n'):
        end=md.find('\n---',4)
        if end!=-1:
            fm={}
            for ln in md[4:end].split('\n'):
                if ':' in ln: k,v=ln.split(':',1); fm[k.strip()]=v.strip()
            return fm, md[end+4:].lstrip('\n')
    return {}, md

TODAY=datetime.date.today().isoformat()
SOURCES={}; LIVE=[]
for _fn,_grp,_label,_url in PAGES:
    _fm,_body=front_matter(open(DRAFTS+_fn).read())
    if _fm.get('publish_date','')>TODAY:
        print('  %-32s scheduled %s — held back' % (_url,_fm['publish_date']))
        continue
    SOURCES[_url]=_body; LIVE.append((_fn,_grp,_label,_url))
LABELS={url:label for _,_,label,url in LIVE}
# <title> overrides (SEO length fixes applied directly to the tag; H1/og:title keep the draft's long form)
TITLE_TAG={'/compare/browsermcp-io':'Browser MCP vs. browsermcp.io \u2014 which is maintained? (2026)'}
def related(url):
    if url=='/docs/what-is-browser-mcp': links=INSTALL+['/docs/tools','/compare/browsermcp-io']
    elif url in INSTALL: links=['/docs/what-is-browser-mcp','/docs/tools','/compare/browsermcp-io']+[u for u in INSTALL if u!=url][:2]
    elif url=='/docs/tools': links=['/docs/install-claude-code','/docs/what-is-browser-mcp','/compare/browsermcp-io']
    else: links=['/docs/install-claude-code','/docs/what-is-browser-mcp','/docs/tools']
    links=[u for u in links if u in LABELS]
    lis=''.join('<li><a href="%s/">%s</a><span>%s</span></li>'%(u,html.escape(LABELS.get(u,u)),html.escape(CTX.get(u,''))) for u in links)
    return '<div class="related"><h2>Related</h2><ul>'+lis+'</ul></div>'

def inline(t):
    t=html.escape(t,quote=False)
    t=re.sub(r'`([^`]+)`',r'<code>\1</code>',t); t=re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',t)
    t=re.sub(r'(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)',r'<i>\1</i>',t)
    t=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<a href="\2">\1</a>',t); return t
def strip_md(t):
    t=re.sub(r'`([^`]+)`',r'\1',t); t=re.sub(r'\*\*([^*]+)\*\*',r'\1',t)
    t=re.sub(r'\*([^*\n]+)\*',r'\1',t)
    t=re.sub(r'\[([^\]]+)\]\([^)]+\)',r'\1',t); return t.strip()
def clean_lines(md):
    lines=md.split('\n')
    while lines and lines[0].strip().startswith('//'): lines.pop(0)
    while lines and lines[0].strip()=='': lines.pop(0)
    NOTE=re.compile(r'Suggested (URL|title|meta)|Last verified:', re.I)
    lines=[x for x in lines if not NOTE.search(x)]
    while lines and lines[0].strip()=='': lines.pop(0)
    return lines
def md_to_html(lines):
    out=[];i=0;n=len(lines)
    while i<n:
        line=lines[i]
        if line.strip().startswith('```'):
            i+=1;code=[]
            while i<n and not lines[i].strip().startswith('```'): code.append(lines[i]);i+=1
            i+=1;out.append('<div class="code"><pre>'+html.escape('\n'.join(code))+'</pre><button class="copy">Copy</button></div>');continue
        if '|' in line and i+1<n and re.match(r'^\s*\|?[\s:|-]+\|?\s*$',lines[i+1]) and '-' in lines[i+1]:
            hd=[c.strip() for c in line.strip().strip('|').split('|')];i+=2;rows=[]
            while i<n and '|' in lines[i] and lines[i].strip(): rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')]);i+=1
            t='<div class="scroll"><table><tr>'+''.join('<th>%s</th>'%inline(h) for h in hd)+'</tr>'
            for r in rows: t+='<tr>'+''.join('<td>%s</td>'%inline(c) for c in r)+'</tr>'
            out.append(t+'</table></div>');continue
        m=re.match(r'^(#{1,4})\s+(.*)$',line)
        if m: out.append('<h%d>%s</h%d>'%(len(m.group(1)),inline(m.group(2)),len(m.group(1))));i+=1;continue
        if re.match(r'^\s*---+\s*$',line): out.append('<hr>');i+=1;continue
        if line.strip().startswith('>'):
            bq=[]
            while i<n and lines[i].strip().startswith('>'): bq.append(lines[i].strip().lstrip('>').strip());i+=1
            out.append('<blockquote>'+inline(' '.join(bq))+'</blockquote>');continue
        if re.match(r'^\s*[-*]\s+',line) or re.match(r'^\s*\d+\.\s+',line):
            ordered=bool(re.match(r'^\s*\d+\.\s+',line));items=[]
            while i<n and (re.match(r'^\s*[-*]\s+',lines[i]) or re.match(r'^\s*\d+\.\s+',lines[i])):
                items.append('<li>'+inline(re.sub(r'^\s*(?:[-*]|\d+\.)\s+','',lines[i]))+'</li>');i+=1
            tag='ol' if ordered else 'ul';out.append('<%s>%s</%s>'%(tag,''.join(items),tag));continue
        if line.strip()=='': i+=1;continue
        para=[line];i+=1
        while i<n and lines[i].strip() and not re.match(r'^(#{1,4}\s|```|>|\s*[-*]\s|\s*\d+\.\s|\s*---+\s*$)',lines[i]) and '|' not in lines[i]: para.append(lines[i]);i+=1
        out.append('<p>'+inline(' '.join(para))+'</p>')
    return '\n'.join(out)
def title_of(lines):
    for l in lines:
        m=re.match(r'^#\s+(.*)$',l)
        if m: return strip_md(m.group(1))
    return 'Browser MCP'
def meta_desc(lines):
    started=False; in_code=False
    for l in lines:
        s=l.strip()
        if s.startswith('```'): in_code = not in_code; continue
        if in_code: continue
        if re.match(r'^#\s',l): started=True; continue
        if not started: continue
        if not s or s.startswith(('#','>','|','-','*')) or re.match(r'^\d+\.',s): continue
        d=strip_md(s)
        if len(d)>60: return (d[:152].rsplit(' ',1)[0]+'…') if len(d)>155 else d
    return 'Browser MCP — give your AI agent a real, already-logged-in Chrome.'
def extract_faq(lines):
    # find ## FAQ section, parse **Q?** + answer
    faq=[];in_faq=False;q=None;a=[]
    for l in lines:
        if re.match(r'^##\s',l):
            if in_faq and q: faq.append((q,' '.join(a).strip())); q=None;a=[]
            in_faq = bool(re.search(r'FAQ|Ofte stillede|Frequently', l, re.I))
            continue
        if not in_faq: continue
        m=re.match(r'^\*\*(.+?)\*\*\s*$', l.strip())
        if m:
            if q: faq.append((q,' '.join(a).strip()))
            q=strip_md(m.group(1)); a=[]
        elif l.strip() and q:
            a.append(strip_md(l.strip()))
    if q: faq.append((q,' '.join(a).strip()))
    return [(qq,aa) for qq,aa in faq if qq.endswith('?') and aa]

def head(title, desc, url):
    can='https://browsermcp.dev'+url+'/'
    t=html.escape(title); d=html.escape(desc)
    h=['<meta charset="utf-8">','<meta name="viewport" content="width=device-width,initial-scale=1">',
      (('<title>%s</title>'%html.escape(TITLE_TAG[url])) if url in TITLE_TAG else ('<title>%s &middot; Browser MCP</title>'%t)),
      '<meta name="description" content="%s">'%d,
      '<link rel="canonical" href="%s">'%can,
      '<link rel="icon" type="image/svg+xml" href="/logo.svg"><link rel="icon" type="image/x-icon" href="/favicon.ico">',
      '<meta property="og:type" content="article"><meta property="og:site_name" content="Browser MCP">',
      '<meta property="og:title" content="%s">'%t,'<meta property="og:description" content="%s">'%d,
      '<meta property="og:url" content="%s">'%can,
      '<meta property="og:image" content="%s"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'%OG,
      '<meta name="twitter:card" content="summary_large_image">','<meta name="twitter:title" content="%s">'%t,
      '<meta name="twitter:description" content="%s">'%d,'<meta name="twitter:image" content="%s">'%OG,
      '<link rel="stylesheet" href="/assets/docs.css">']
    return '\n'.join(h)

def jsonld(title, desc, url, section, faq):
    can='https://browsermcp.dev'+url+'/'
    blocks=[]
    # BreadcrumbList
    sec_url='https://browsermcp.dev/docs/install-claude-code/' if section=='Docs' else 'https://browsermcp.dev/compare/browsermcp-io/'
    blocks.append({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"Home","item":"https://browsermcp.dev/"},
        {"@type":"ListItem","position":2,"name":section,"item":sec_url},
        {"@type":"ListItem","position":3,"name":title,"item":can}]})
    # TechArticle (Org author per author-policy)
    blocks.append({"@context":"https://schema.org","@type":"TechArticle","headline":title,"description":desc,"url":can,
        "author":{"@type":"Organization","name":"Agent360","url":"https://agent360.dk"},
        "publisher":{"@type":"Organization","name":"Agent360","url":"https://agent360.dk"},
        "about":{"@type":"SoftwareApplication","name":"Browser MCP","applicationCategory":"DeveloperApplication",
            "operatingSystem":"Chrome","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}})
    # FAQPage
    if faq:
        blocks.append({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
            {"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}} for q,a in faq]})
    return '\n'.join('<script type="application/ld+json">%s</script>'%json.dumps(b,ensure_ascii=False) for b in blocks)

def sidebar(active):
    groups={}
    for fn,grp,label,url in LIVE: groups.setdefault(grp,[]).append((label,url))
    h=''
    for grp,items in groups.items():
        h+='<div class="grp">%s</div>'%grp
        for label,url in items:
            cls=' class="active"' if url==active else ''
            h+='<a href="%s/"%s>%s</a>'%(url,cls,label)
    return h

nfaq=0
for fn,grp,label,url in LIVE:
    lines=clean_lines(SOURCES[url])
    title=title_of(lines); desc=meta_desc(lines); faq=extract_faq(lines); nfaq+=1 if faq else 0
    body=md_to_html(lines)
    page='<!doctype html><html lang="en"><head>\n'+head(title,desc,url)+'\n'+jsonld(title,desc,url,grp,faq)+'\n</head><body>'
    page+='<div class="top"><div class="top-in"><a class="logo" href="/" style="color:inherit"><span class="m">&#10022;</span> Browser MCP</a><span class="star">&#9733; 22</span></div></div>'
    page+='<div class="shell"><nav class="side">'+sidebar(url)+'</nav><main class="content">'+body+related(url)+'</main></div>'
    page+='<script src="/assets/docs.js"></script></body></html>'
    disk=REPO+url.strip('/')+'/index.html'
    os.makedirs(os.path.dirname(disk),exist_ok=True)
    open(disk,'w').write(page)
    print('  %-32s desc=%dch faq=%d' % (url, len(desc), len(faq)))
print('Regenerated %d pages · FAQPage schema on %d' % (len(LIVE), nfaq))

