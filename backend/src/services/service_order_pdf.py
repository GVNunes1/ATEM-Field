#!/usr/bin/env python3
"""Generate an ATEM Field service-order PDF from a JSON payload."""

from __future__ import annotations

import base64
import json
import os
import re
import sys
from io import BytesIO
from pathlib import Path
from typing import Any, Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    Image,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.pdfgen.canvas import Canvas


PRIMARY = colors.HexColor("#175CD3")
PRIMARY_SOFT = colors.HexColor("#EAF2FF")
TEAL = colors.HexColor("#0F766E")
SUCCESS_SOFT = colors.HexColor("#ECFDF5")
AMBER = colors.HexColor("#B45309")
AMBER_SOFT = colors.HexColor("#FFFBEB")
INK = colors.HexColor("#162033")
SECONDARY = colors.HexColor("#344054")
MUTED = colors.HexColor("#667085")
BORDER = colors.HexColor("#DFE7F1")
SURFACE = colors.HexColor("#F4F7FB")
WHITE = colors.white

PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT_MARGIN = 15 * mm
RIGHT_MARGIN = 15 * mm
TOP_MARGIN = 31 * mm
BOTTOM_MARGIN = 17 * mm
CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN


def clean(value: Any, fallback: str = "-") -> str:
    if value is None:
        return fallback
    text = str(value).strip()
    return text or fallback


def safe_filename(value: Any) -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", clean(value, "OS"))
    return text.strip("-.") or "OS"


def logo_path() -> Path | None:
    candidates = [
        Path(os.environ.get("ATEM_LOGO_PATH", "")),
        Path.cwd() / ".." / "frontend" / "public" / "logomarca.png",
        Path.cwd() / ".." / "frontend" / "public" / "logomarca_azul_clinico_sem_fundo.png",
        Path.cwd() / ".." / "frontend" / "dist" / "logomarca.png",
        Path.cwd() / ".." / "frontend" / "dist" / "logomarca_azul_clinico_sem_fundo.png",
    ]
    for candidate in candidates:
        try:
            if candidate and candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue
    return None


STYLES = getSampleStyleSheet()
BODY = ParagraphStyle(
    "Body",
    parent=STYLES["BodyText"],
    fontName="Helvetica",
    fontSize=8.2,
    leading=11,
    textColor=SECONDARY,
    spaceAfter=0,
)
BODY_CENTER = ParagraphStyle("BodyCenter", parent=BODY, alignment=TA_CENTER)
BODY_SMALL = ParagraphStyle("BodySmall", parent=BODY, fontSize=7.1, leading=9, textColor=MUTED)
BODY_SMALL_CENTER = ParagraphStyle("BodySmallCenter", parent=BODY_SMALL, alignment=TA_CENTER)
VALUE = ParagraphStyle("Value", parent=BODY, fontName="Helvetica-Bold", textColor=INK)
VALUE_CENTER = ParagraphStyle("ValueCenter", parent=VALUE, alignment=TA_CENTER)
LABEL = ParagraphStyle(
    "Label",
    parent=BODY_SMALL,
    fontName="Helvetica-Bold",
    fontSize=6.5,
    leading=8,
    textColor=MUTED,
    uppercase=True,
)
SECTION_TITLE = ParagraphStyle(
    "SectionTitle",
    parent=STYLES["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=10.2,
    leading=12,
    textColor=INK,
    spaceAfter=0,
)
SECTION_DESC = ParagraphStyle("SectionDesc", parent=BODY_SMALL, fontSize=6.8, leading=8.5)
DOC_TITLE = ParagraphStyle(
    "DocTitle",
    parent=STYLES["Heading1"],
    fontName="Helvetica-Bold",
    fontSize=15,
    leading=17,
    textColor=INK,
    alignment=TA_LEFT,
)


def p(value: Any, style: ParagraphStyle = BODY) -> Paragraph:
    text = clean(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(text.replace("\n", "<br/>"), style)


def field(label: str, value: Any, width: float | None = None) -> Table:
    table = Table([[p(label.upper(), LABEL)], [p(value, VALUE)]], colWidths=[width] if width else None)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.55, BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, 0), 5),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
                ("TOPPADDING", (0, 1), (-1, 1), 2),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 6),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def section_heading(number: int, title: str, description: str) -> KeepTogether:
    badge = Table([[p(str(number), VALUE_CENTER)]], colWidths=[8 * mm], rowHeights=[8 * mm])
    badge.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PRIMARY_SOFT),
                ("BOX", (0, 0), (-1, -1), 0.6, PRIMARY),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    title_block = Table([[p(title, SECTION_TITLE)], [p(description, SECTION_DESC)]], colWidths=[CONTENT_WIDTH - 11 * mm])
    title_block.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    row = Table([[badge, title_block]], colWidths=[10 * mm, CONTENT_WIDTH - 10 * mm])
    row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return KeepTogether([row, Spacer(1, 2.5 * mm)])


def field_grid(items: Iterable[tuple[str, Any]], columns: int = 2) -> Table:
    values = list(items)
    width = CONTENT_WIDTH / columns
    cells = [field(label, value, width=width) for label, value in values]
    while len(cells) % columns:
        cells.append(field("", "", width=width))
    rows = [cells[index:index + columns] for index in range(0, len(cells), columns)]
    table = Table(rows, colWidths=[width] * columns, hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    return table


def description_box(label: str, value: Any) -> Table:
    table = Table([[p(label.upper(), LABEL)], [p(value, BODY)]], colWidths=[CONTENT_WIDTH])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), SURFACE),
                ("BACKGROUND", (0, 1), (-1, 1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.55, BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
                ("TOPPADDING", (0, 1), (-1, 1), 6),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def status_cell(value: Any) -> Table:
    text = clean(value, "Não informado")
    normalized = text.lower()
    background = SUCCESS_SOFT if normalized == "sim" else colors.HexColor("#FEF2F2") if normalized in ("não", "nao") else SURFACE
    foreground = TEAL if normalized == "sim" else colors.HexColor("#B42318") if normalized in ("não", "nao") else MUTED
    table = Table([[p(text, ParagraphStyle("Status", parent=VALUE_CENTER, fontSize=7.2, textColor=foreground))]], colWidths=[25 * mm])
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), background), ("BOX", (0, 0), (-1, -1), 0.55, foreground), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return table


def signature_image(value: Any) -> Image | Spacer:
    if not value or not isinstance(value, str) or "," not in value:
        return Spacer(1, 19 * mm)
    try:
        encoded = value.split(",", 1)[1]
        image = Image(BytesIO(base64.b64decode(encoded)))
        image._restrictSize(62 * mm, 18 * mm)
        return image
    except Exception:
        return Spacer(1, 19 * mm)


def signature_box(label: str, name: Any, signature: Any) -> Table:
    table = Table(
        [[p(label.upper(), LABEL)], [signature_image(signature)], [HRFlowable(width="100%", thickness=0.5, color=BORDER)], [p(name, VALUE_CENTER)]],
        colWidths=[CONTENT_WIDTH / 2 - 3 * mm],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.55, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def header_footer(canvas: Canvas, doc: BaseDocTemplate, data: dict[str, Any]) -> None:
    canvas.saveState()
    logo = logo_path()
    if logo:
        try:
            canvas.drawImage(str(logo), LEFT_MARGIN, PAGE_HEIGHT - 22 * mm, width=28 * mm, height=10 * mm, preserveAspectRatio=True, anchor="w", mask="auto")
        except Exception:
            logo = None
    if not logo:
        canvas.setFillColor(PRIMARY)
        canvas.setFont("Helvetica-Bold", 14)
        canvas.drawString(LEFT_MARGIN, PAGE_HEIGHT - 17 * mm, "ATEM")

    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 8.5)
    canvas.drawRightString(PAGE_WIDTH - RIGHT_MARGIN, PAGE_HEIGHT - 14 * mm, "ATEM Field")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 6.8)
    canvas.drawRightString(PAGE_WIDTH - RIGHT_MARGIN, PAGE_HEIGHT - 18 * mm, "Operações em campo e assistência técnica")
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.55)
    canvas.line(LEFT_MARGIN, PAGE_HEIGHT - 24 * mm, PAGE_WIDTH - RIGHT_MARGIN, PAGE_HEIGHT - 24 * mm)

    footer_y = 10 * mm
    canvas.line(LEFT_MARGIN, footer_y + 4 * mm, PAGE_WIDTH - RIGHT_MARGIN, footer_y + 4 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 6.5)
    order_number = clean(data.get("Atendimento"), "OS sem número")
    canvas.drawString(LEFT_MARGIN, footer_y, f"{order_number}  |  Documento gerado pelo ATEM Field")
    page_text = f"Página {doc.page}"
    canvas.drawRightString(PAGE_WIDTH - RIGHT_MARGIN, footer_y, page_text)
    canvas.restoreState()


def build_pdf(data: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frame = Frame(LEFT_MARGIN, BOTTOM_MARGIN, CONTENT_WIDTH, PAGE_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    template = PageTemplate(id="ATEMField", frames=[frame], onPage=lambda canvas, doc: header_footer(canvas, doc, data))
    doc = BaseDocTemplate(str(output_path), pagesize=A4, leftMargin=LEFT_MARGIN, rightMargin=RIGHT_MARGIN, topMargin=TOP_MARGIN, bottomMargin=BOTTOM_MARGIN, title=f"Ordem de Serviço {clean(data.get('Atendimento'), '')}", author="ATEM Field", subject="Relatório de atendimento técnico")
    doc.addPageTemplates([template])

    signed = bool(data.get("Assinatura_Tecnico") or data.get("Assinatura_Cliente"))
    status_text = "ASSINADA" if signed else "AGUARDANDO ASSINATURA"
    status_bg = SUCCESS_SOFT if signed else AMBER_SOFT
    status_color = TEAL if signed else AMBER
    status = Table([[p(status_text, ParagraphStyle("DocumentStatus", parent=VALUE_CENTER, fontSize=7, textColor=status_color))]], colWidths=[42 * mm])
    status.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), status_bg), ("BOX", (0, 0), (-1, -1), 0.6, status_color), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))

    heading = Table(
        [[Table([[p("ORDEM DE SERVIÇO", DOC_TITLE)], [p("Relatório de atendimento técnico", BODY_SMALL)]], colWidths=[CONTENT_WIDTH - 45 * mm]), status]],
        colWidths=[CONTENT_WIDTH - 45 * mm, 45 * mm],
    )
    heading.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))

    story: list[Any] = [heading, Spacer(1, 4 * mm)]

    story += [
        section_heading(1, "Dados do atendimento", "Identificação, data e horários"),
        field_grid(
            [
                ("Nº Atendimento / OS", data.get("Atendimento")),
                ("Data", data.get("Data")),
                ("Hora de chegada", data.get("Hora_Chegada")),
                ("Hora de saída", data.get("Hora_Saida")),
            ],
            columns=4,
        ),
        Spacer(1, 4 * mm),
        section_heading(2, "Identificação do cliente", "Instituição e contato responsável"),
        field_grid(
            [
                ("Cliente / Razão Social", data.get("Cliente")),
                ("Telefone", data.get("Fone")),
                ("Endereço", data.get("Endereco")),
                ("Contato no local", data.get("Contato")),
                ("Setor do contato", data.get("Setor_Contato")),
                ("E-mail", data.get("Email")),
            ],
            columns=2,
        ),
        Spacer(1, 4 * mm),
        section_heading(3, "Equipamento", "Identificação técnica e patrimônio"),
        field_grid(
            [
                ("Equipamento", data.get("Equipamento")),
                ("Marca / Fabricante", data.get("Marca")),
                ("Modelo", data.get("Modelo")),
                ("Nº de Série", data.get("Serie")),
                ("TAG / Patrimônio", data.get("Patrimonio")),
                ("Setor do equipamento", data.get("Setor_Equipamento")),
            ],
            columns=3,
        ),
        Spacer(1, 4 * mm),
        section_heading(4, "Diagnóstico", "Problema informado, constatação e causas"),
        description_box("Defeito reclamado", data.get("Defeito_Reclamado")),
        Spacer(1, 2 * mm),
        description_box("Defeito constatado", data.get("Defeito_Constatado")),
        Spacer(1, 2 * mm),
        description_box("Causas", data.get("Causas")),
        Spacer(1, 4 * mm),
        section_heading(5, "Serviços executados", "Procedimentos técnicos realizados"),
        description_box("Descrição dos serviços", data.get("Descricao_Servicos") or data.get("Descricao_Servico")),
        Spacer(1, 4 * mm),
        section_heading(6, "Peças e acessórios", "Componentes utilizados ou orçados"),
    ]

    parts = data.get("Pecas") if isinstance(data.get("Pecas"), list) else []
    part_rows: list[list[Any]] = [[p("Qtd.", LABEL), p("Código", LABEL), p("Descrição da peça", LABEL), p("Aplicado", LABEL)]]
    meaningful_parts = [part for part in parts if isinstance(part, dict) and any(clean(part.get(key), "") for key in ("quantidade", "codigo", "nome", "aplicado"))]
    if not meaningful_parts:
        part_rows.append([p("-", BODY_CENTER), p("-", BODY_CENTER), p("Nenhuma peça informada", BODY_SMALL_CENTER), p("-", BODY_CENTER)])
    else:
        for part in meaningful_parts:
            part_rows.append([p(part.get("quantidade"), BODY_CENTER), p(part.get("codigo"), BODY_CENTER), p(part.get("nome")), p(part.get("aplicado"), BODY_CENTER)])
    parts_table = Table(part_rows, colWidths=[18 * mm, 30 * mm, CONTENT_WIDTH - 80 * mm, 32 * mm], repeatRows=1)
    parts_table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), SURFACE), ("GRID", (0, 0), (-1, -1), 0.55, BORDER), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story += [parts_table, Spacer(1, 4 * mm), section_heading(7, "Medições e verificações", "Infraestrutura elétrica e pneumática")]

    measurement_rows = [
        [p("Verificação", LABEL), p("Resultado", LABEL), p("Valor / complemento", LABEL)],
        [p("Tensão adequada"), status_cell(data.get("Tensao_Adequada")), p(data.get("Tensao_Volts"))],
        [p("Tomada adequada"), status_cell(data.get("Tomada_Adequada")), p("")],
        [p("Pressão adequada"), status_cell(data.get("Pressao_Adequada")), p(data.get("Pressao_Valor"))],
        [p("Umidade na rede"), status_cell(data.get("Umidade_Rede")), p("")],
        [p("Válvula reguladora"), status_cell(data.get("Valvula_Reguladora")), p("")],
    ]
    measurements = Table(measurement_rows, colWidths=[CONTENT_WIDTH * 0.42, CONTENT_WIDTH * 0.25, CONTENT_WIDTH * 0.33], repeatRows=1)
    measurements.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), SURFACE), ("GRID", (0, 0), (-1, -1), 0.55, BORDER), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story += [
        measurements,
        Spacer(1, 4 * mm),
        section_heading(8, "Conclusão", "Status final e observações"),
        field_grid([("Serviço concluído?", data.get("Servico_Concluido"))], columns=1),
        Spacer(1, 2 * mm),
        description_box("Observações técnicas", data.get("Observacoes") or data.get("Observacoes_Tecnicas")),
        Spacer(1, 4 * mm),
        section_heading(9, "Responsáveis e assinaturas", "Validação do atendimento"),
    ]

    signatures = Table(
        [[signature_box("Técnico responsável", data.get("Nome_Tecnico"), data.get("Assinatura_Tecnico")), signature_box("Responsável no cliente", data.get("Nome_Cliente"), data.get("Assinatura_Cliente"))]],
        colWidths=[CONTENT_WIDTH / 2, CONTENT_WIDTH / 2],
    )
    signatures.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story += [signatures]

    doc.build(story)


def main() -> int:
    if len(sys.argv) != 3:
        print(json.dumps({"success": False, "error": "Uso: service_order_pdf.py <dados.json> <saida.pdf>"}, ensure_ascii=False))
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    try:
        with input_path.open("r", encoding="utf-8") as stream:
            data = json.load(stream)
        build_pdf(data, output_path)
        print(json.dumps({"success": True, "output": str(output_path), "filename": safe_filename(output_path.name)}, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
