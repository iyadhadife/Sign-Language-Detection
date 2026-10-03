"""Import TensorFlow configured for CPU-only inference."""
import os

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")

import tensorflow as tf  # noqa: E402

from . import config  # noqa: E402

if config.TF_THREADS > 0:
    tf.config.threading.set_intra_op_parallelism_threads(config.TF_THREADS)
    tf.config.threading.set_inter_op_parallelism_threads(max(1, config.TF_THREADS // 2))

__all__ = ["tf"]
