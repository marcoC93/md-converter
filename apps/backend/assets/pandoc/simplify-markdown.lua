-- Filtro Lua per la modalità "semplice" verso Markdown.
-- Pandoc scrive in HTML le immagini con attributi (larghezza, altezza) e le figure con didascalia,
-- perché il Markdown GFM non sa rappresentarli. Qui li semplifichiamo in sintassi Markdown pura.

function Image(image)
  -- Il testo alternativo di Word ("descr") arriva come attributo: lo usiamo come testo dell'immagine.
  local alt = image.attributes["alt"]
  if alt ~= nil and alt ~= "" then
    image.caption = pandoc.Inlines(pandoc.Str(alt))
  end
  image.attr = pandoc.Attr()
  return image
end

function Figure(figure)
  local blocks = pandoc.Blocks({})
  for _, block in ipairs(figure.content) do
    blocks:insert(block)
  end
  if #figure.caption.long > 0 then
    blocks:insert(pandoc.Para({ pandoc.Emph(pandoc.utils.blocks_to_inlines(figure.caption.long)) }))
  end
  return blocks
end
