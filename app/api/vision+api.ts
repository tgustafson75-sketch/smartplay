import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      mode,
      image,
      hole,
      par,
      distance,
      courseName,
      dominantMiss = null,
    } = body;

    console.log('[vision] received:', {
      mode,
      hasImage: !!image,
      imageLength: image?.length ?? 0,
      hole,
      par,
      distance,
    });

    if (!image) {
      return Response.json({ message: 'No image provided.' });
    }

    if (mode === 'hole') {
      const missContext = dominantMiss
        ? ' Player tends to miss ' + dominantMiss + '.'
        : '';

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/jpeg;base64,' + image,
                detail: 'low',
              },
            },
            {
              type: 'text',
              text:
                'You are Kevin, an experienced golf caddie. ' +
                'This is an overhead satellite view of hole ' +
                (hole ?? '?') + ', par ' + (par ?? '?') + ', ' +
                (distance ?? '?') + ' yards' +
                (courseName ? ' at ' + courseName : '') + '.' +
                missContext +
                ' In exactly 2 sentences as Kevin: identify the main hazard ' +
                'and recommend an aim point, then give one specific swing thought ' +
                'or club choice. Be direct and warm. Use yards not meters. ' +
                'Do not start with "I can see". Do not describe the image. ' +
                "Just give Kevin's read.",
            },
          ],
        }],
      });

      const message = completion.choices[0]?.message?.content ?? '';
      console.log('[vision] response:', message);
      return Response.json({ message });
    }

    return Response.json({ message: 'Mode not supported yet.' });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[vision] error:', msg);
    return Response.json({
      message: 'Take a look at the layout and pick your target.',
    });
  }
}
