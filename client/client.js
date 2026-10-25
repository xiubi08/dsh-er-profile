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
      const [url, setUrl] = React.useState(undefined)
      const [failed, setFailed] = React.useState(false)

      React.useEffect(() => {
        if (!attachment) return undefined
        let cancelled = false
        setFailed(false)
        props.loadImage(attachment).then(
          value => { if (!cancelled) setUrl(value) },
          () => { if (!cancelled) setFailed(true) },
        )
        return () => { cancelled = true }
      }, [attachment && attachment.attachmentId])

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
        url
          ? h('img', {
              src: url,
              alt: caption,
              style: { width: '100%', maxWidth: 720, borderRadius: 12, display: 'block' },
            })
          : h('div', { style: { fontSize: 12, color: 'var(--dsh-text-secondary, #8f6a78)' } },
              failed ? '战绩图加载失败，请查看上方文字摘要。' : '战绩图已生成，正在加载…'),
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
