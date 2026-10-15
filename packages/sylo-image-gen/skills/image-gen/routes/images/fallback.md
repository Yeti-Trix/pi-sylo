# Images route fallback

Generate from chat: ask the agent to *"generate an image of …"* — it calls **`sylo_image_gen_generate`**.
Search your library with `sylo_image_gen_list`; organize with `sylo_image_gen_organize`.

Run **`sylo_image_gen_doctor`** if generation fails. Enable **sylo-image-gen** in Capability manager.
Generation is all-local through your own ComfyUI install (default API `http://127.0.0.1:8188`).

Full settings live in the sylo-image-gen extension config; the Images route UI lands with the backend.