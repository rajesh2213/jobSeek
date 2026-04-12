"""
Job description line classifier API.
Loads a HuggingFace sequence-classification model once at startup; runs batched inference.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

# Default: apps/inference/models/job-parser-model
_DEFAULT_MODEL_DIR = Path(__file__).resolve().parent / "models" / "job-parser-model"
MODEL_DIR = Path(os.environ.get("JOB_PARSER_MODEL_DIR", str(_DEFAULT_MODEL_DIR))).resolve()

# API / Pydantic field order (stable JSON shape). Bucket assignment uses model.config.id2label only.
API_LABEL_KEYS = [
    "position",
    "responsibility",
    "requirement",
    "experience",
    "benefit",
    "contact",
    "other",
]

tokenizer = None
model = None
label_names: list[str] = []
device = None

EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
embedding_model: SentenceTransformer | None = None

logger = logging.getLogger(__name__)

app = FastAPI(title="JobSeek Inference", version="1.0.0")


class ParseRequest(BaseModel):
    description: str = Field(..., min_length=1)


class ParseResponse(BaseModel):
    position: list[str]
    responsibility: list[str]
    requirement: list[str]
    experience: list[str]
    benefit: list[str]
    contact: list[str]
    other: list[str]


class EmbedRequest(BaseModel):
    sentences: List[str]


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]


class MatchRequest(BaseModel):
    keyword: str
    bullets: List[str]  # resume bullet points to compare against


class MatchResponse(BaseModel):
    best_match: Optional[str]
    best_match_index: int
    similarity: float
    all_similarities: List[float]


def _resolve_label_names() -> list[str]:
    """Map class index -> label string from the loaded HF config (never hardcode training order)."""
    global model
    if model is None:
        return list(API_LABEL_KEYS)
    cfg = getattr(model.config, "id2label", None) or {}
    if not cfg:
        return list(API_LABEL_KEYS)
    num = int(getattr(model.config, "num_labels", len(cfg)))
    out: list[str] = []
    for i in range(num):
        v = cfg.get(str(i), cfg.get(i))
        if v is None:
            v = API_LABEL_KEYS[min(i, len(API_LABEL_KEYS) - 1)]
        out.append(str(v).lower())
    return out if out else list(API_LABEL_KEYS)


def _empty_buckets() -> dict[str, list[str]]:
    return {k: [] for k in API_LABEL_KEYS}


@app.on_event("startup")
def load_model() -> None:
    global tokenizer, model, label_names, device, embedding_model
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    if not MODEL_DIR.is_dir():
        raise RuntimeError(
            f"Model directory not found: {MODEL_DIR}. "
            "Set JOB_PARSER_MODEL_DIR or place the model under apps/inference/models/job-parser-model."
        )

    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR))
    model = AutoModelForSequenceClassification.from_pretrained(str(MODEL_DIR))
    model.eval()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    label_names.clear()
    label_names.extend(_resolve_label_names())

    embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    logger.info("Embedding model loaded: %s", EMBEDDING_MODEL_NAME)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model_loaded": str(model is not None)}


@app.post("/parse", response_model=ParseResponse)
def parse(req: ParseRequest) -> ParseResponse:
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    import torch
    import torch.nn.functional as F

    lines = [ln.strip() for ln in req.description.splitlines() if ln.strip()]
    if not lines:
        return ParseResponse(**_empty_buckets())

    batch_size = int(os.environ.get("JOB_PARSER_BATCH_SIZE", "32"))
    all_preds: list[int] = []
    all_conf: list[float] = []

    with torch.no_grad():
        for start in range(0, len(lines), batch_size):
            batch = lines[start : start + batch_size]
            enc = tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            enc = {k: v.to(device) for k, v in enc.items()}
            logits = model(**enc).logits
            probs = F.softmax(logits, dim=-1)
            max_conf, preds = probs.max(dim=-1)
            all_preds.extend(preds.cpu().tolist())
            all_conf.extend(max_conf.cpu().tolist())

    buckets = _empty_buckets()
    names = label_names if label_names else list(API_LABEL_KEYS)

    min_conf = float(os.environ.get("JOB_PARSER_MIN_CONFIDENCE", "0.6"))
    short_other = int(os.environ.get("JOB_PARSER_SHORT_OTHER_CHARS", "50"))

    for line, pred_id, conf in zip(lines, all_preds, all_conf):
        if float(conf) < min_conf:
            continue
        idx = int(pred_id)
        if 0 <= idx < len(names):
            lab = names[idx]
        else:
            lab = "other"
        if lab not in buckets:
            lab = "other"
        if lab == "other" and len(line) < short_other:
            continue
        buckets[lab].append(line)

    for k in API_LABEL_KEYS:
        buckets.setdefault(k, [])

    return ParseResponse(
        position=buckets["position"],
        responsibility=buckets["responsibility"],
        requirement=buckets["requirement"],
        experience=buckets["experience"],
        benefit=buckets["benefit"],
        contact=buckets["contact"],
        other=buckets["other"],
    )


@app.post("/resume/embed", response_model=EmbedResponse)
def embed_sentences(req: EmbedRequest) -> EmbedResponse:
    """Embed a list of sentences using all-MiniLM-L6-v2"""
    if embedding_model is None:
        raise HTTPException(status_code=503, detail="Embedding model not loaded")
    if not req.sentences:
        return EmbedResponse(embeddings=[])
    embeddings = embedding_model.encode(req.sentences, convert_to_numpy=True)
    return EmbedResponse(embeddings=embeddings.tolist())


@app.post("/resume/match", response_model=MatchResponse)
def match_keyword_to_bullets(req: MatchRequest) -> MatchResponse:
    """Find which resume bullet is semantically closest to a missing keyword"""
    if embedding_model is None:
        raise HTTPException(status_code=503, detail="Embedding model not loaded")
    if not req.bullets:
        return MatchResponse(best_match=None, best_match_index=-1, similarity=0.0, all_similarities=[])

    keyword_emb = embedding_model.encode([req.keyword], convert_to_numpy=True)
    bullet_embs = embedding_model.encode(req.bullets, convert_to_numpy=True)

    sims = cosine_similarity(keyword_emb, bullet_embs)[0]
    best_idx = int(np.argmax(sims))

    return MatchResponse(
        best_match=req.bullets[best_idx],
        best_match_index=best_idx,
        similarity=float(sims[best_idx]),
        all_similarities=sims.tolist(),
    )
