# Videos route fallback

Generate from chat: ask the agent to *"generate a video of …"* / *"turn this image into a living photo"* —
it calls **`sylo_video_gen_generate`** (a poster still appears in chat, the full clip lands in the library).
Search with `sylo_video_gen_list`; curate with `sylo_video_gen_organize`; run **`sylo_video_gen_doctor`**
if anything fails.

Enable **sylo-video-gen** in Capability manager. Generation is all-local through your own ComfyUI install
(default API `http://127.0.0.1:8188`) — draft `wan22-ti2v-5b`, final `wan22-a14b`, restyle `wan21-vace-14b`,
all Apache-2.0 commercial-ok; model downloads via Comfy-Org repacks are guided by the doctor.

Full settings live in the sylo-video-gen extension config; the desktop route UI serves from the built
assets in this folder when the Sylo host is running.