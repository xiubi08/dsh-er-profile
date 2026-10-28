window.__ModuleLoader__.load({
  id: '@local/dsh-er-profile',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    function PlayerCard(props) {
      const phase = props.phase
      const block = props.block
      const meta = phase === 'result' ? block.meta : undefined
      const image = meta && meta.image ? meta.image : undefined
      const attachment = image && image.attachment ? image.attachment : undefined
      const player = meta && meta.player ? meta.player : undefined
      const summary = meta && meta.summary ? meta.summary : undefined
      const character = meta && meta.character ? meta.character : undefined
      const characterStats = meta && meta.stats ? meta.stats : undefined
      const rank = meta && meta.rank ? meta.rank : undefined
      // Server ships a self-contained data: thumbnail (`image.preview`). A bare
      // <img src> cannot carry the authenticated connection credential, so the
      // api/file route and the attachment loader are only fallbacks.
      const preview = image && typeof image.preview === 'string' && image.preview.startsWith('data:')
        ? image.preview
        : undefined
      const fileUrl = React.useMemo(() => {
        if (!image || typeof image.path !== 'string' || image.path === '') return undefined
        try {
          return new URL(`api/file?path=${encodeURIComponent(image.path)}`, document.baseURI).href
        } catch (_error) {
          return undefined
        }
      }, [image && image.path])
      const [url, setUrl] = React.useState(preview !== undefined ? preview : fileUrl)
      const [failed, setFailed] = React.useState(false)

      React.useEffect(() => {
        setFailed(false)
        if (preview !== undefined) {
          setUrl(preview)
          return undefined
        }
        if (fileUrl !== undefined) {
          setUrl(fileUrl)
          return undefined
        }
        if (!attachment) {
          setUrl(undefined)
          return undefined
        }
        let cancelled = false
        props.loadImage(attachment).then(
          value => { if (!cancelled) setUrl(value) },
          () => { if (!cancelled) setFailed(true) },
        )
        return () => { cancelled = true }
      }, [preview, fileUrl, attachment && attachment.attachmentId])

      if (phase !== 'result') {
        return h('div', { style: { padding: '10px 4px', color: 'var(--dsh-text-secondary, #8f6a78)', fontSize: 13 } },
          '正在查询永恒轮回战绩…')
      }
      if (block.isError) {
        const text = Array.isArray(block.content)
          ? block.content.filter(part => part && part.type === 'text').map(part => part.text).join('\n')
          : '查询失败'
        return h('div', { style: { padding: '10px 4px', color: '#cf3f56', fontSize: 13 } }, text)
      }

      const caption = player
        ? `${player.name} · ${player.season} ${player.mode} · MMR ${player.mmr} · ${player.tier}`
        : character
          ? `${character.name} · ${character.weapon} | ${character.tier} · ${character.badge}`
          : rank
            ? rank.title
            : '永恒轮回战绩'
      const stats = summary
        ? `近 ${summary.play} 场 · 胜率 ${summary.winRate}% · 平均排名 ${summary.avgRank} · 平均击杀 ${summary.avgKill}`
        : characterStats
          ? `胜率 ${characterStats.winRate.toFixed(1)}% · TOP3 ${characterStats.top3Rate.toFixed(1)}% · 平均排名 #${characterStats.avgRank.toFixed(2)} · 选择率 ${characterStats.pickRate.toFixed(2)}%`
          : rank
            ? rank.subtitle
            : undefined

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0 8px' } },
        h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsh-text-primary, #3c1e2d)' } }, caption),
        stats ? h('div', { style: { fontSize: 12, color: 'var(--dsh-text-secondary, #8f6a78)' } }, stats) : null,
        url !== undefined && !failed
          ? h('a', {
              href: url,
              target: '_blank',
              rel: 'noopener noreferrer',
              title: preview !== undefined ? '在新标签页打开图片' : '打开原图',
              style: { display: 'block' },
            },
            h('img', {
              src: url,
              alt: caption,
              onError: () => { setFailed(true) },
              style: { width: '100%', maxWidth: 560, borderRadius: 12, display: 'block' },
            }))
          : h('div', { style: { fontSize: 12, color: 'var(--dsh-text-secondary, #8f6a78)', wordBreak: 'break-all' } },
              failed
                ? `战绩图加载失败。原图：${image && image.path ? image.path : '未生成'}`
                : '战绩图已生成，正在加载…'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('tool.call.toolview', () => {
          ctx.slots.register({ name: 'tool.call.toolview', key: 'er_player_profile' }, PlayerCard)
          ctx.slots.register({ name: 'tool.call.toolview', key: 'er_character_stats' }, PlayerCard)
          ctx.slots.register({ name: 'tool.call.toolview', key: 'er_character_rank' }, PlayerCard)
        })
      },
    }
  },
})
